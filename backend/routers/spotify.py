from fastapi import APIRouter
from fastapi.responses import RedirectResponse
import spotipy
from spotipy.oauth2 import SpotifyOAuth
import os
from dotenv import load_dotenv

load_dotenv()

router = APIRouter()

auth_manager = SpotifyOAuth(
    client_id=os.getenv("SPOTIFY_CLIENT_ID"),
    client_secret=os.getenv("SPOTIFY_CLIENT_SECRET"),
    redirect_uri=os.getenv("SPOTIFY_REDIRECT_URI"),
    scope="user-read-currently-playing user-read-playback-state user-modify-playback-state",
    cache_path=".spotify_cache"
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
        "duration_ms": playback["item"]["duration_ms"]
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