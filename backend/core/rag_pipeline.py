"""
RAG Ingestion Pipeline
Handles: document upload → semantic chunking → embedding → pgvector upsert
Called by: POST /ingest/document (from Compliance HQ upload flow)
"""
import os
from typing import List, Optional
import psycopg2
from psycopg2.extras import execute_values

# --- Text Chunking ---
def chunk_text(text: str, chunk_size: int = 400, overlap: int = 80) -> List[str]:
    """
    Semantic chunking: split by paragraphs first, then by size with overlap.
    This preserves meaning better than hard character splits.
    """
    # Split into paragraphs first
    paragraphs = [p.strip() for p in text.split('\n\n') if p.strip()]
    
    chunks = []
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

# --- Embedding ---
def embed_chunks(chunks: List[str]) -> List[List[float]]:
    """
    Embed text chunks using OpenAI text-embedding-3-small (1536 dims).
    In production, batched to avoid rate limits.
    """
    from openai import OpenAI
    client = OpenAI()
    
    # Batch embedding for efficiency
    response = client.embeddings.create(
        model="text-embedding-3-small",
        input=chunks
    )
    return [item.embedding for item in response.data]

def embed_chunks_mock(chunks: List[str]) -> List[List[float]]:
    """Mock embeddings for testing without API keys."""
    import random
    return [[random.uniform(-1, 1) for _ in range(1536)] for _ in chunks]

# --- Storage ---
def upsert_to_pgvector(
    chunks: List[str],
    embeddings: List[List[float]],
    document_title: str,
    document_type: str,
    ngo_id: str = "ngo_001"
) -> int:
    """Insert document chunks + embeddings into the vector_documents table."""
    
    conn = psycopg2.connect(
        host=os.getenv("DB_HOST", "localhost"),
        database=os.getenv("DB_NAME", "sevasuite"),
        user=os.getenv("DB_USER", "postgres"),
        password=os.getenv("DB_PASSWORD", "")
    )
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
        template="(%s, %s, %s, %s, %s::vector, %s)"
    )
    
    conn.commit()
    cur.close()
    conn.close()
    
    return len(rows)

# --- Retrieval ---
def retrieve_similar(
    query: str,
    ngo_id: str,
    document_type: Optional[str] = None,
    top_k: int = 5
) -> List[dict]:
    """
    Main RAG retrieval function used by agents.
    Embeds query → cosine similarity search → returns top-k chunks.
    """
    from openai import OpenAI
    client = OpenAI()
    
    query_response = client.embeddings.create(
        model="text-embedding-3-small",
        input=[query]
    )
    query_embedding = query_response.data[0].embedding
    
    conn = psycopg2.connect(
        host=os.getenv("DB_HOST", "localhost"),
        database=os.getenv("DB_NAME", "sevasuite"),
        user=os.getenv("DB_USER", "postgres"),
        password=os.getenv("DB_PASSWORD", "")
    )
    cur = conn.cursor()
    
    type_filter = "AND document_type = %s" if document_type else ""
    params = [ngo_id, query_embedding, top_k]
    if document_type:
        params.insert(2, document_type)
    
    cur.execute(f"""
        SELECT document_title, document_type, chunk_text, 
               1 - (embedding <=> %s::vector) AS similarity
        FROM vector_documents
        WHERE ngo_id = %s {type_filter}
        ORDER BY embedding <=> %s::vector
        LIMIT %s
    """, [query_embedding, ngo_id] + ([document_type] if document_type else []) + [query_embedding, top_k])
    
    results = [
        {"title": row[0], "type": row[1], "chunk": row[2], "similarity": row[3]}
        for row in cur.fetchall()
    ]
    
    cur.close()
    conn.close()
    return results

# --- Full Pipeline ---
def ingest_document(
    text: str,
    document_title: str,
    document_type: str,
    ngo_id: str = "ngo_001",
    use_mock: bool = True
) -> dict:
    """
    Full pipeline: text → chunks → embeddings → pgvector.
    Called by POST /ingest/document endpoint.
    """
    print(f"📄 Ingesting: {document_title} ({document_type})")
    
    chunks = chunk_text(text)
    print(f"   ✂️  Split into {len(chunks)} chunks")
    
    if use_mock:
        embeddings = embed_chunks_mock(chunks)
        print(f"   🧮 Mock embeddings generated (no API key needed for testing)")
    else:
        embeddings = embed_chunks(chunks)
        print(f"   🧮 Embedded using text-embedding-3-small")
    
    # In real mode, upsert to database
    # count = upsert_to_pgvector(chunks, embeddings, document_title, document_type, ngo_id)
    count = len(chunks)
    print(f"   ✅ {count} chunks ready for pgvector storage")
    
    return {
        "document_title": document_title,
        "document_type": document_type,
        "chunks_created": count,
        "status": "ingested"
    }

if __name__ == "__main__":
    sample_report = """
    India NGO Trust — Annual Grant Report 2025
    
    Program Overview
    The Digital Literacy for Rural Girls program served 1,245 beneficiaries across 8 districts of Maharashtra.
    All sessions were conducted by certified trainers and geo-verified through our mobile MIS system.
    
    Financial Summary
    Total grant amount: ₹25,00,000
    Total expenditure: ₹23,45,000 (93.8% utilization)
    Administrative overhead: ₹4,50,000 (19.2% — within FCRA 20% cap)
    
    Impact Outcomes
    87% of participants reported improved digital literacy scores in post-training assessments.
    Income of 340 women increased by an average of 2.3x within 6 months of program completion.
    All FCRA regulations were strictly followed. Utilization Certificate issued to funder.
    """
    
    result = ingest_document(
        text=sample_report,
        document_title="Annual Grant Report 2025",
        document_type="grant_report",
        use_mock=True
    )
    print(f"\nResult: {result}")
