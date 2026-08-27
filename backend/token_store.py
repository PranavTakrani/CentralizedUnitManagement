"""Supabase-backed OAuth token storage.

Replaces the local-file token caches (token.json / .spotify_cache) so the app
can run on an ephemeral serverless filesystem.

Table: oauth_tokens(provider, user_id, access_token, refresh_token, expires_at,
updated_at), PK (provider, user_id). RLS is on with no policies, so this must
use the service_role key.
"""

import os
from datetime import datetime, timezone

from supabase import create_client, Client

TABLE = "oauth_tokens"

_client: Client | None = None


def get_client() -> Client:
    global _client
    if _client is None:
        url = os.getenv("SUPABASE_URL")
        key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        if not url or not key:
            raise RuntimeError(
                "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set"
            )
        _client = create_client(url, key)
    return _client


def get_token(provider: str, user_id: str) -> dict | None:
    """Return the stored row for a provider+user, or None if it doesn't exist."""
    result = (
        get_client()
        .table(TABLE)
        .select("provider, user_id, access_token, refresh_token, expires_at")
        .eq("provider", provider)
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    rows = result.data or []
    return rows[0] if rows else None


def save_token(
    provider: str,
    user_id: str,
    access_token: str | None,
    refresh_token: str,
    expires_at: int | None,
) -> None:
    """Upsert a provider+user's tokens. expires_at is unix epoch seconds."""
    get_client().table(TABLE).upsert(
        {
            "provider": provider,
            "user_id": user_id,
            "access_token": access_token,
            "refresh_token": refresh_token,
            "expires_at": expires_at,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        },
        on_conflict="provider,user_id",
    ).execute()
