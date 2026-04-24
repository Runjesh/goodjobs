"""
AWS S3 Presigned URL Storage for SevaSuite
Handles file upload/download for:
  - Compliance Vault (80G receipts, FCRA filings)
  - CSR Document Room (proposals, MoUs)
  - Field Photos (geotagged images from mobile)
  - Grant Reports
"""
import os
import uuid
from datetime import datetime
from typing import Optional
import boto3
from botocore.exceptions import ClientError, NoCredentialsError

# ── Config ────────────────────────────────────────────────────────────────────
AWS_REGION       = os.getenv("AWS_REGION", "ap-south-1")      # Mumbai region
S3_BUCKET        = os.getenv("AWS_S3_BUCKET_NAME", "sevasuite-documents")
UPLOAD_EXPIRY    = int(os.getenv("S3_UPLOAD_URL_EXPIRY", 3600))   # 1 hour
DOWNLOAD_EXPIRY  = int(os.getenv("S3_DOWNLOAD_URL_EXPIRY", 900))  # 15 minutes
USE_MOCK         = os.getenv("USE_MOCK_S3", "true").lower() == "true"

# S3 path structure: {ngo_id}/{folder}/{filename}
FOLDER_MAP = {
    "compliance":   "compliance-vault",
    "csr":          "csr-documents",
    "field_photo":  "field-photos",
    "grant":        "grant-reports",
    "profile":      "ngo-profile",
    "misc":         "misc",
}

def _get_s3_client():
    """Return a boto3 S3 client. Raises on missing credentials."""
    return boto3.client(
        "s3",
        region_name=AWS_REGION,
        aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
        aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY"),
    )

def _build_key(ngo_id: str, folder: str, filename: str) -> str:
    """Build an S3 object key scoped to the NGO."""
    safe_folder = FOLDER_MAP.get(folder, "misc")
    return f"{ngo_id}/{safe_folder}/{filename}"

# ── Presigned Upload URL ──────────────────────────────────────────────────────
def generate_presigned_upload_url(
    ngo_id: str,
    folder: str,
    filename: str,
    content_type: str = "application/octet-stream",
    expiry: int = UPLOAD_EXPIRY,
) -> dict:
    """
    Generate a presigned S3 URL for direct browser upload.
    Returns: { url, key, expires_in, mock }
    """
    file_id = uuid.uuid4().hex[:8]
    safe_filename = f"{file_id}_{filename}"
    key = _build_key(ngo_id, folder, safe_filename)

    if USE_MOCK:
        return {
            "url": f"https://{S3_BUCKET}.s3.{AWS_REGION}.amazonaws.com/{key}?X-Amz-Expires={expiry}&mock=true",
            "key": key,
            "expires_in": expiry,
            "mock": True,
        }

    try:
        s3 = _get_s3_client()
        url = s3.generate_presigned_url(
            "put_object",
            Params={
                "Bucket": S3_BUCKET,
                "Key": key,
                "ContentType": content_type,
                # Enforce server-side encryption
                "ServerSideEncryption": "AES256",
                # Tag for lifecycle management
                "Tagging": f"ngo_id={ngo_id}&folder={folder}",
            },
            ExpiresIn=expiry,
            HttpMethod="PUT",
        )
        return {"url": url, "key": key, "expires_in": expiry, "mock": False}
    except (ClientError, NoCredentialsError) as e:
        raise RuntimeError(f"S3 upload URL generation failed: {e}")

# ── Presigned Download URL ────────────────────────────────────────────────────
def generate_presigned_download_url(
    key: str,
    original_filename: Optional[str] = None,
    expiry: int = DOWNLOAD_EXPIRY,
) -> dict:
    """
    Generate a presigned S3 URL for secure file download.
    Returns: { url, expires_in, mock }
    """
    if USE_MOCK:
        return {
            "url": f"https://{S3_BUCKET}.s3.{AWS_REGION}.amazonaws.com/{key}?X-Amz-Expires={expiry}&mock=true",
            "expires_in": expiry,
            "mock": True,
        }

    try:
        s3 = _get_s3_client()
        params = {"Bucket": S3_BUCKET, "Key": key}
        if original_filename:
            params["ResponseContentDisposition"] = f'attachment; filename="{original_filename}"'
        url = s3.generate_presigned_url("get_object", Params=params, ExpiresIn=expiry)
        return {"url": url, "expires_in": expiry, "mock": False}
    except (ClientError, NoCredentialsError) as e:
        raise RuntimeError(f"S3 download URL generation failed: {e}")

# ── File Deletion ─────────────────────────────────────────────────────────────
def delete_file(key: str, ngo_id: str) -> dict:
    """
    Delete an S3 object. Validates ngo_id prefix for data isolation.
    Returns: { deleted, key }
    """
    if not key.startswith(f"{ngo_id}/"):
        raise PermissionError(f"Key '{key}' does not belong to NGO '{ngo_id}'")

    if USE_MOCK:
        print(f"[MOCK S3] Deleted: {key}")
        return {"deleted": True, "key": key, "mock": True}

    try:
        s3 = _get_s3_client()
        s3.delete_object(Bucket=S3_BUCKET, Key=key)
        return {"deleted": True, "key": key, "mock": False}
    except (ClientError, NoCredentialsError) as e:
        raise RuntimeError(f"S3 deletion failed: {e}")

# ── List NGO Files ────────────────────────────────────────────────────────────
def list_ngo_files(ngo_id: str, folder: str = "") -> list:
    """
    List all files for an NGO (optionally filtered by folder).
    Returns: [{ key, filename, size, last_modified }]
    """
    prefix = f"{ngo_id}/{FOLDER_MAP.get(folder, '')}/" if folder else f"{ngo_id}/"

    if USE_MOCK:
        return [
            {"key": f"{ngo_id}/compliance-vault/80G_Receipt_2026.pdf", "filename": "80G_Receipt_2026.pdf", "size": 245000, "last_modified": "2026-04-22"},
            {"key": f"{ngo_id}/csr-documents/HDFC_MoU_Draft.pdf", "filename": "HDFC_MoU_Draft.pdf", "size": 1200000, "last_modified": "2026-04-20"},
            {"key": f"{ngo_id}/grant-reports/Ford_Q1_Report.docx", "filename": "Ford_Q1_Report.docx", "size": 890000, "last_modified": "2026-04-18"},
        ]

    try:
        s3 = _get_s3_client()
        resp = s3.list_objects_v2(Bucket=S3_BUCKET, Prefix=prefix)
        files = []
        for obj in resp.get("Contents", []):
            files.append({
                "key": obj["Key"],
                "filename": obj["Key"].split("/")[-1],
                "size": obj["Size"],
                "last_modified": obj["LastModified"].strftime("%Y-%m-%d"),
            })
        return files
    except (ClientError, NoCredentialsError) as e:
        raise RuntimeError(f"S3 list failed: {e}")

if __name__ == "__main__":
    # Quick test in mock mode
    print("=== S3 Storage Mock Test ===")
    up = generate_presigned_upload_url("ngo_001", "csr", "test_proposal.pdf")
    print(f"Upload URL: {up['url'][:80]}...")
    dn = generate_presigned_download_url(up["key"], "test_proposal.pdf")
    print(f"Download URL: {dn['url'][:80]}...")
    files = list_ngo_files("ngo_001")
    print(f"Files: {[f['filename'] for f in files]}")
