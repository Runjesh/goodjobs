"""
RAG Ingestion Pipeline
Handles: document upload → semantic chunking → embedding → pgvector upsert
Called by: POST /ingest/document (from Compliance HQ upload flow)

Embeddings use the same key resolution as chat agents: per-NGO key from Settings,
then OPENAI_API_KEY. When no key is available, ingest falls back to mock vectors.
"""
from __future__ import annotations

import os
from typing import List, Optional

import psycopg2
from psycopg2.extras import execute_values

from core.db import get_database_url
from core.llm_keys import resolve_openai_api_key


def _rag_psycopg2_conn():
    """
    Prefer ``DATABASE_URL`` (same as ``core.db`` / FastAPI).
    Fall back to ``DB_HOST`` / ``DB_NAME`` / … for legacy local setups without a URL string.
    """
    url = get_database_url()
    if url:
        return psycopg2.connect(url)
    if os.getenv("DB_HOST", "").strip():
        return psycopg2.connect(
            host=os.getenv("DB_HOST", "localhost"),
            database=os.getenv("DB_NAME", "sevasuite"),
            user=os.getenv("DB_USER", "postgres"),
            password=os.getenv("DB_PASSWORD", ""),
        )
    return None


# --- Text Chunking ---
def chunk_text(text: str, chunk_size: int = 400, overlap: int = 80) -> List[str]:
    """
    Semantic chunking: split by paragraphs first, then by size with overlap.
    """
    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]

    chunks: List[str] = []
    current_chunk = ""

    for para in paragraphs:
        if len(current_chunk) + len(para) < chunk_size:
            current_chunk += " " + para
        else:
            if current_chunk:
                chunks.append(current_chunk.strip())
            current_chunk = para

    if current_chunk:
        chunks.append(current_chunk.strip())

    return chunks


def embed_chunks(chunks: List[str], *, api_key: str) -> List[List[float]]:
    """Embed text chunks using OpenAI text-embedding-3-small (1536 dims)."""
    from openai import OpenAI

    client = OpenAI(api_key=api_key)
    response = client.embeddings.create(
        model="text-embedding-3-small",
        input=chunks,
    )
    return [item.embedding for item in response.data]


def embed_chunks_mock(chunks: List[str]) -> List[List[float]]:
    """Mock embeddings for testing without API keys."""
    import random

    return [[random.uniform(-1, 1) for _ in range(1536)] for _ in chunks]


def upsert_to_pgvector(
    chunks: List[str],
    embeddings: List[List[float]],
    document_title: str,
    document_type: str,
    ngo_id: str = "ngo_001",
) -> int:
    """Insert document chunks + embeddings into the vector_documents table."""
    conn = _rag_psycopg2_conn()
    if conn is None:
        return 0
    try:
        cur = conn.cursor()

        rows = [
            (document_title, document_type, i, chunk, embedding, ngo_id)
            for i, (chunk, embedding) in enumerate(zip(chunks, embeddings))
        ]

        execute_values(
            cur,
            """INSERT INTO vector_documents
               (document_title, document_type, chunk_index, chunk_text, embedding, ngo_id)
               VALUES %s
               ON CONFLICT DO NOTHING""",
            rows,
            template="(%s, %s, %s, %s, %s::vector, %s)",
        )

        conn.commit()
        cur.close()
        return len(rows)
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def retrieve_similar(
    query: str,
    ngo_id: str,
    document_type: Optional[str] = None,
    top_k: int = 5,
) -> List[dict]:
    """
    Embed query → cosine similarity search → returns top-k chunks.
    Returns an empty list when no OpenAI key is configured (cannot embed the query).
    """
    key = resolve_openai_api_key(ngo_id)
    if not key:
        return []

    from openai import OpenAI

    client = OpenAI(api_key=key)
    query_response = client.embeddings.create(
        model="text-embedding-3-small",
        input=[query],
    )
    query_embedding = query_response.data[0].embedding

    conn = _rag_psycopg2_conn()
    if conn is None:
        return []
    try:
        cur = conn.cursor()

        type_filter = "AND document_type = %s" if document_type else ""

        cur.execute(
            f"""
            SELECT document_title, document_type, chunk_text,
                   1 - (embedding <=> %s::vector) AS similarity
            FROM vector_documents
            WHERE ngo_id = %s {type_filter}
            ORDER BY embedding <=> %s::vector
            LIMIT %s
            """,
            (
                query_embedding,
                ngo_id,
                *([document_type] if document_type else []),
                query_embedding,
                top_k,
            ),
        )

        return [
            {"title": row[0], "type": row[1], "chunk": row[2], "similarity": row[3]}
            for row in cur.fetchall()
        ]
    finally:
        conn.close()


def ingest_document(
    text: str,
    document_title: str,
    document_type: str,
    ngo_id: str = "ngo_001",
    use_mock: Optional[bool] = None,
) -> dict:
    """
    Full pipeline: text → chunks → embeddings (and optional pgvector upsert).

    use_mock:
      - None (default): use real embeddings iff resolve_openai_api_key(ngo_id) succeeds.
      - True / False: force mock or real (real still requires a key or raises).
    """
    print(f"📄 Ingesting: {document_title} ({document_type})")

    key = resolve_openai_api_key(ngo_id)
    if use_mock is None:
        effective_mock = key is None
    else:
        effective_mock = use_mock

    chunks = chunk_text(text)
    print(f"   ✂️  Split into {len(chunks)} chunks")

    if effective_mock:
        embeddings = embed_chunks_mock(chunks)
        mode = "mock"
        print("   🧮 Mock embeddings (no API key for this tenant)")
    else:
        if not key:
            raise ValueError("use_mock=False but no OpenAI API key resolved for this NGO.")
        embeddings = embed_chunks(chunks, api_key=key)
        mode = "openai"
        print("   🧮 Embedded using text-embedding-3-small")

    stored = 0
    if mode == "openai":
        try:
            stored = upsert_to_pgvector(
                chunks, embeddings, document_title, document_type, ngo_id
            )
            if stored:
                print(f"   💾 Upserted {stored} rows to vector_documents")
            elif not get_database_url() and not os.getenv("DB_HOST", "").strip():
                print("   ⚠ No DATABASE_URL / DB_HOST — vectors not persisted")
        except Exception as exc:
            print(f"   ⚠ pgvector upsert skipped: {exc}")

    count = len(chunks)
    print(f"   ✅ {count} chunks processed")

    return {
        "document_title": document_title,
        "document_type": document_type,
        "ngo_id": ngo_id,
        "chunks_created": count,
        "embedding_mode": mode,
        "vectors_upserted": stored,
        "status": "ingested",
    }
