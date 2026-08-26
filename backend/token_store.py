"""Supabase-backed OAuth token storage.

Replaces the local-file token caches (token.json / .spotify_cache) so the app
can run on an ephemeral serverless filesystem.

Table: oauth_tokens(provider pk, access_token, refresh_token, expires_at, updated_at)
RLS is on with no policies, so this must use the service_role key.
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


def get_token(provider: str) -> dict | None:
    """Return the stored row for a provider, or None if it doesn't exist."""
    result = (
        get_client()
        .table(TABLE)
        .select("provider, access_token, refresh_token, expires_at")
        .eq("provider", provider)
        .limit(1)
        .execute()
    )
    rows = result.data or []
    return rows[0] if rows else None


def save_token(
    provider: str,
    access_token: str | None,
    refresh_token: str,
    expires_at: int | None,
) -> None:
    """Upsert a provider's tokens. expires_at is unix epoch seconds."""
    get_client().table(TABLE).upsert(
        {
            "provider": provider,
            "access_token": access_token,
            "refresh_token": refresh_token,
            "expires_at": expires_at,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
    ).execute()
