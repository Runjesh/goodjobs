"""
JWT Authentication Middleware for SevaSuite FastAPI
Provides token verification, current user extraction, and RBAC enforcement.
"""
import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import jwt, JWTError
from pydantic import BaseModel

# ── Config ────────────────────────────────────────────────────────────────────
JWT_SECRET = os.getenv("JWT_SECRET", "sevasuite-dev-secret-change-in-production")
JWT_ALGORITHM = "HS256"
JWT_EXPIRY_HOURS = 24

security = HTTPBearer(auto_error=False)

# ── Models ────────────────────────────────────────────────────────────────────
class TokenUser(BaseModel):
    user_id: str
    email: str
    role: str           # ed | finance | programs | field | board
    ngo_id: str
    ngo_name: str
    exp: int

# ── Token generation (used by /auth/login endpoint) ───────────────────────────
def create_access_token(
    user_id: str,
    email: str,
    role: str,
    ngo_id: str,
    ngo_name: str,
    expires_hours: int = JWT_EXPIRY_HOURS
) -> str:
    """Generate a signed JWT for the given user."""
    expire = datetime.now(timezone.utc) + timedelta(hours=expires_hours)
    payload = {
        "sub": user_id,
        "email": email,
        "role": role,
        "ngo_id": ngo_id,
        "ngo_name": ngo_name,
        "exp": int(expire.timestamp()),
        "iat": int(datetime.now(timezone.utc).timestamp()),
        "jti": str(uuid.uuid4()),          # Unique token ID for revocation
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

# ── Token verification ────────────────────────────────────────────────────────
def _decode_token(token: str) -> TokenUser:
    """Verify and decode a JWT. Raises HTTPException on failure."""
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return TokenUser(
            user_id=payload["sub"],
            email=payload["email"],
            role=payload["role"],
            ngo_id=payload["ngo_id"],
            ngo_name=payload["ngo_name"],
            exp=payload["exp"],
        )
    except JWTError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid or expired token: {e}",
            headers={"WWW-Authenticate": "Bearer"},
        )

# ── FastAPI Dependencies ──────────────────────────────────────────────────────
async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)
) -> TokenUser:
    """
    FastAPI dependency: extract and verify JWT from Authorization header.
    Usage: `user: TokenUser = Depends(get_current_user)`
    """
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required. Please provide a Bearer token.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return _decode_token(credentials.credentials)


async def get_current_user_optional(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)
) -> Optional[TokenUser]:
    """Like get_current_user but returns None instead of raising for public endpoints."""
    if not credentials:
        return None
    try:
        return _decode_token(credentials.credentials)
    except HTTPException:
        return None


def require_role(*allowed_roles: str):
    """
    Dependency factory: enforce RBAC at endpoint level.
    Usage:  `user = Depends(require_role("ed", "finance"))`
    """
    async def _check(user: TokenUser = Depends(get_current_user)) -> TokenUser:
        if user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Role '{user.role}' is not authorized for this action. Required: {list(allowed_roles)}"
            )
        return user
    return _check


def require_ngo_scope(ngo_id: str, user: TokenUser):
    """
    Utility: verify the user belongs to the requested NGO.
    Call this inside endpoints that receive an ngo_id path param.
    """
    if user.role != "ed" and user.ngo_id != ngo_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cross-NGO data access is not permitted."
        )

# ── Demo Login helper (replaces real Supabase/DB lookup in dev) ───────────────
DEMO_USERS = {
    "admin@indiango.org": {
        "user_id": "user_001",
        "name": "Anjali Mehta",
        "password": "demo1234",
        "role": "ed",
        "ngo_id": "ngo_001",
        "ngo_name": "India NGO Trust",
    },
    "finance@indiango.org": {
        "user_id": "user_002",
        "name": "Rajan Sharma",
        "password": "demo1234",
        "role": "finance",
        "ngo_id": "ngo_001",
        "ngo_name": "India NGO Trust",
    },
    "programs@indiango.org": {
        "user_id": "user_003",
        "name": "Priya Nair",
        "password": "demo1234",
        "role": "programs",
        "ngo_id": "ngo_001",
        "ngo_name": "India NGO Trust",
    },
    "field@indiango.org": {
        "user_id": "user_004",
        "name": "Ramesh Kumar",
        "password": "demo1234",
        "role": "field",
        "ngo_id": "ngo_001",
        "ngo_name": "India NGO Trust",
    },
    "board@indiango.org": {
        "user_id": "user_005",
        "name": "Dr. Sunita Rao",
        "password": "demo1234",
        "role": "board",
        "ngo_id": "ngo_001",
        "ngo_name": "India NGO Trust",
    },
}

def demo_authenticate(email: str, password: str) -> Optional[dict]:
    """
    Demo authentication — replace with real DB lookup in production.
    Returns user dict or None.
    """
    user = DEMO_USERS.get(email)
    if user and user["password"] == password:
        return user
    return None
