from fastapi import APIRouter
from fastapi.responses import RedirectResponse
import spotipy
from spotipy.oauth2 import SpotifyOAuth
from spotipy.cache_handler import CacheHandler
import os
from dotenv import load_dotenv

import token_store

load_dotenv()

router = APIRouter()

SCOPE = "user-read-currently-playing user-read-playback-state user-modify-playback-state"
PROVIDER = "spotify"
# Spotify is a single-tenant integration (the app owner's account only), so
# it uses a fixed user_id rather than a per-request caller.
OWNER_USER_ID = "a52d07e3-e8cc-4811-9a33-270e1e7b3517"


class SupabaseCacheHandler(CacheHandler):
    """Stores the spotipy token in Supabase instead of a local cache file."""

    def get_cached_token(self):
        # Deliberately do not catch exceptions here: if this returns None,
        # spotipy falls back to an interactive browser-based auth flow that
        # tries to bind a local HTTP server, which hangs/crashes on
        # serverless. A real failure (e.g. Supabase unreachable) should
        # surface as an error instead of triggering that fallback.
        row = token_store.get_token(PROVIDER, OWNER_USER_ID)
        if not row or not row.get("refresh_token"):
            return None
        return {
            "access_token": row.get("access_token"),
            "refresh_token": row["refresh_token"],
            # 0 => spotipy treats it as expired and refreshes via refresh_token
            "expires_at": row.get("expires_at") or 0,
            "token_type": "Bearer",
            "scope": SCOPE,
        }

    def save_token_to_cache(self, token_info):
        refresh_token = token_info.get("refresh_token")
        if not refresh_token:
            # refresh_token is NOT NULL in the table; Spotify omits it on some
            # refresh responses, so fall back to the one already stored.
            existing = token_store.get_token(PROVIDER, OWNER_USER_ID) or {}
            refresh_token = existing.get("refresh_token")
            if not refresh_token:
                return
        token_store.save_token(
            PROVIDER,
            OWNER_USER_ID,
            access_token=token_info.get("access_token"),
            refresh_token=refresh_token,
            expires_at=token_info.get("expires_at"),
        )


auth_manager = SpotifyOAuth(
    client_id=os.getenv("SPOTIFY_CLIENT_ID"),
    client_secret=os.getenv("SPOTIFY_CLIENT_SECRET"),
    redirect_uri=os.getenv("SPOTIFY_REDIRECT_URI"),
    scope=SCOPE,
    cache_handler=SupabaseCacheHandler()
)

sp = spotipy.Spotify(auth_manager=auth_manager)

@router.get("/login")
def login():
    auth_url = auth_manager.get_authorize_url()
    return RedirectResponse(auth_url)

@router.get("/callback")
def callback(code: str):
    auth_manager.get_access_token(code)
    return {"status": "authenticated"}

@router.get("/now-playing")
def now_playing():
    playback = sp.current_playback()
    if not playback:
        return {"is_playing": False, "track": None}
    return {
        "is_playing": playback["is_playing"],
        "track": playback["item"]["name"],
        "artist": playback["item"]["artists"][0]["name"],
        "album": playback["item"]["album"]["name"],
        "album_art": playback["item"]["album"]["images"][0]["url"],
        "progress_ms": playback["progress_ms"],
        "duration_ms": playback["item"]["duration_ms"],
        "volume_percent": playback.get("device", {}).get("volume_percent", 50)
    }

@router.post("/play")
def play():
    playback = sp.current_playback()
    if playback and playback["is_playing"]:
        sp.pause_playback()
    else:
        sp.start_playback()
    return {"status": "ok"}

@router.post("/next")
def next_track():
    sp.next_track()
    return {"status": "ok"}

@router.post("/previous")
def previous_track():
    sp.previous_track()
    return {"status": "ok"}

@router.post("/volume")
def set_volume(volume: int):
    sp.volume(volume)
    return {"status": "ok"}
