import os
import secrets
import datetime

import pytz
from fastapi import APIRouter, HTTPException, Header, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request as GoogleRequest
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build
from supabase import create_client

import token_store

TZ = pytz.timezone("America/Los_Angeles")

router = APIRouter()

SCOPES = ["https://www.googleapis.com/auth/calendar.readonly"]

PROVIDER = "google_calendar"
TOKEN_URI = "https://oauth2.googleapis.com/token"
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173")


def _anon_client():
    url = os.getenv("SUPABASE_URL")
    anon = os.getenv("SUPABASE_ANON_KEY")
    if not url or not anon:
        raise HTTPException(
            status_code=500,
            detail="SUPABASE_URL / SUPABASE_ANON_KEY must be set.",
        )
    return create_client(url, anon)


def _bearer_token(authorization: str | None) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    return authorization.split(" ", 1)[1].strip()


def _user_client(authorization: str | None):
    """Supabase client authenticated as the calling user, so RLS applies."""
    token = _bearer_token(authorization)
    client = _anon_client()
    client.postgrest.auth(token)
    return client


def _verified_user_id(authorization: str | None) -> str:
    """Resolve the calling user's id, verified by Supabase (never trust a
    client-decoded JWT — this is what decides whose Google token gets used)."""
    token = _bearer_token(authorization)
    try:
        result = _anon_client().auth.get_user(token)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    if not result or not result.user:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return result.user.id


def _oauth_flow(redirect_uri: str) -> Flow:
    client_id = os.getenv("GOOGLE_CLIENT_ID")
    client_secret = os.getenv("GOOGLE_CLIENT_SECRET")
    if not client_id or not client_secret:
        raise HTTPException(
            status_code=500,
            detail="GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not configured.",
        )
    return Flow.from_client_config(
        {
            "web": {
                "client_id": client_id,
                "client_secret": client_secret,
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": TOKEN_URI,
            }
        },
        scopes=SCOPES,
        redirect_uri=redirect_uri,
    )


def _user_calendar_ids(authorization: str | None):
    """Calendar IDs the CALLING user has enabled (per-user 'calendars' table)."""
    sb = _user_client(authorization)
    result = sb.table("calendars").select("calendar_id").execute()
    return [row["calendar_id"] for row in (result.data or [])]


class EnabledCalendarIn(BaseModel):
    calendar_id: str
    label: str | None = None


@router.get("/enabled")
def list_enabled_calendars(authorization: str | None = Header(default=None)):
    sb = _user_client(authorization)
    res = sb.table("calendars").select("*").order("created_at").execute()
    return res.data or []


@router.post("/enabled")
def enable_calendar(body: EnabledCalendarIn, authorization: str | None = Header(default=None)):
    sb = _user_client(authorization)
    try:
        res = sb.table("calendars").insert(
            {"calendar_id": body.calendar_id, "label": body.label}
        ).execute()
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    return (res.data or [None])[0]


@router.delete("/enabled/{row_id}")
def disable_calendar(row_id: str, authorization: str | None = Header(default=None)):
    sb = _user_client(authorization)
    try:
        sb.table("calendars").delete().eq("id", row_id).execute()
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"status": "deleted"}


def get_credentials(user_id: str):
    """Build Google credentials from the refresh token stored for this user."""
    client_id = os.getenv("GOOGLE_CLIENT_ID")
    client_secret = os.getenv("GOOGLE_CLIENT_SECRET")
    if not client_id or not client_secret:
        raise HTTPException(
            status_code=500,
            detail="GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not configured.",
        )

    try:
        row = token_store.get_token(PROVIDER, user_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Could not read stored Google token: {e}")

    if not row or not row.get("refresh_token"):
        raise HTTPException(
            status_code=409,
            detail="Google Calendar is not connected for this user.",
        )

    expires_at = row.get("expires_at")
    creds = Credentials(
        token=row.get("access_token"),
        refresh_token=row["refresh_token"],
        token_uri=TOKEN_URI,
        client_id=client_id,
        client_secret=client_secret,
        scopes=SCOPES,
        # google-auth wants a naive UTC datetime. Treat a missing expiry as
        # already expired so we refresh instead of sending a stale token.
        expiry=datetime.datetime.fromtimestamp(
            expires_at or 0, datetime.timezone.utc
        ).replace(tzinfo=None),
    )

    if not creds.valid:
        try:
            creds.refresh(GoogleRequest())
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Google token refresh failed: {e}")
        # Cache the fresh access token so later cold starts reuse it until it
        # expires, instead of hitting Google's token endpoint every request.
        try:
            token_store.save_token(
                PROVIDER,
                user_id,
                access_token=creds.token,
                refresh_token=creds.refresh_token or row["refresh_token"],
                expires_at=int(creds.expiry.replace(tzinfo=datetime.timezone.utc).timestamp())
                if creds.expiry
                else None,
            )
        except Exception:
            # A failed write-back only costs us an extra refresh next time.
            pass

    return creds


def _time_range(days, start):
    if start:
        y, mo, d = map(int, start.split("-"))
        local_midnight = TZ.localize(datetime.datetime(y, mo, d))
    else:
        local_now = datetime.datetime.now(TZ)
        local_midnight = local_now.replace(hour=0, minute=0, second=0, microsecond=0)
    time_min = local_midnight.astimezone(pytz.utc).isoformat()
    time_max = (local_midnight + datetime.timedelta(days=days)).astimezone(pytz.utc).isoformat()
    return time_min, time_max


def _fetch_events(creds, calendar_ids, days, start):
    service = build("calendar", "v3", credentials=creds)
    time_min, time_max = _time_range(days, start)

    events = []
    for calendar_id in calendar_ids:
        try:
            result = service.events().list(
                calendarId=calendar_id,
                timeMin=time_min,
                timeMax=time_max,
                singleEvents=True,
                orderBy="startTime"
            ).execute()
        except Exception:
            # A bad/inaccessible calendar_id (typo, revoked access) shouldn't
            # take down every other calendar's events.
            continue
        events.extend(result.get("items", []))

    return [
        {
            "title": e.get("summary"),
            "start": e.get("start", {}).get("dateTime"),
            "end": e.get("end", {}).get("dateTime"),
            "location": e.get("location")
        }
        for e in events
    ]


# ---- personal calendars ----------------------------------------------------

@router.get("/today")
def get_today(authorization: str | None = Header(default=None)):
    return get_events(days=1, authorization=authorization)


@router.get("/upcoming")
def get_upcoming(days: int = 7, start: str | None = None, authorization: str | None = Header(default=None)):
    return get_events(days=days, start=start, authorization=authorization)


def get_events(days=1, start=None, authorization=None):
    user_id = _verified_user_id(authorization)
    calendar_ids = _user_calendar_ids(authorization)
    if not calendar_ids:
        return []
    try:
        creds = get_credentials(user_id)
    except HTTPException as e:
        if e.status_code == 409:
            # Not connected yet -> empty schedule, not an error.
            return []
        raise
    return _fetch_events(creds, calendar_ids, days, start)


# ---- Google OAuth (per-user connect) ---------------------------------------

@router.post("/oauth/start")
def oauth_start(request: Request, authorization: str | None = Header(default=None)):
    user_id = _verified_user_id(authorization)
    state = secrets.token_urlsafe(24)

    try:
        (
            token_store.get_client()
            .table("oauth_pending_state")
            .insert({"state": state, "user_id": user_id})
            .execute()
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Could not start OAuth flow: {e}")

    redirect_uri = str(request.base_url).rstrip("/") + "/calendar/oauth/callback"
    flow = _oauth_flow(redirect_uri)
    auth_url, _ = flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        prompt="consent",
        state=state,
    )
    return {"url": auth_url}


@router.get("/oauth/callback")
def oauth_callback(request: Request, code: str, state: str):
    try:
        pending = (
            token_store.get_client()
            .table("oauth_pending_state")
            .select("user_id")
            .eq("state", state)
            .limit(1)
            .execute()
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Could not verify OAuth state: {e}")

    rows = pending.data or []
    if not rows:
        raise HTTPException(status_code=400, detail="Unknown or expired OAuth state")
    user_id = rows[0]["user_id"]

    redirect_uri = str(request.base_url).rstrip("/") + "/calendar/oauth/callback"
    flow = _oauth_flow(redirect_uri)
    try:
        flow.fetch_token(code=code)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Google token exchange failed: {e}")

    creds = flow.credentials
    token_store.save_token(
        PROVIDER,
        user_id,
        access_token=creds.token,
        refresh_token=creds.refresh_token,
        expires_at=int(creds.expiry.replace(tzinfo=datetime.timezone.utc).timestamp())
        if creds.expiry
        else None,
    )

    try:
        token_store.get_client().table("oauth_pending_state").delete().eq("state", state).execute()
    except Exception:
        pass

    return RedirectResponse(f"{FRONTEND_URL}/schedule?connected=1")


@router.get("/status")
def oauth_status(authorization: str | None = Header(default=None)):
    user_id = _verified_user_id(authorization)
    row = token_store.get_token(PROVIDER, user_id)
    return {"connected": bool(row and row.get("refresh_token"))}


@router.get("/google-calendars")
def list_google_calendars(authorization: str | None = Header(default=None)):
    """The caller's own Google calendars, for the enable/disable picker."""
    user_id = _verified_user_id(authorization)
    creds = get_credentials(user_id)
    service = build("calendar", "v3", credentials=creds)
    try:
        result = service.calendarList().list().execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Could not list Google calendars: {e}")
    return [
        {
            "id": c.get("id"),
            "summary": c.get("summary"),
            "color": c.get("backgroundColor"),
            "primary": c.get("primary", False),
        }
        for c in result.get("items", [])
    ]


# ---- sharing a calendar with another user ----------------------------------

class ShareIn(BaseModel):
    calendar_id: str
    label: str | None = None
    email: str


@router.post("/share")
def share_calendar(body: ShareIn, authorization: str | None = Header(default=None)):
    sb = _user_client(authorization)
    try:
        found = sb.rpc("find_user_by_email", {"p_email": body.email}).execute()
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    rows = found.data or []
    if not rows:
        raise HTTPException(status_code=404, detail="No user with that email")
    grantee_id = rows[0]["id"]

    try:
        sb.table("calendar_shares").insert(
            {"grantee_id": grantee_id, "calendar_id": body.calendar_id, "label": body.label}
        ).execute()
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"status": "shared"}


@router.get("/my-shares")
def my_shares(authorization: str | None = Header(default=None)):
    """Calendars I've sent to other people."""
    user_id = _verified_user_id(authorization)
    sb = _user_client(authorization)
    res = sb.table("calendar_shares").select("*").eq("owner_id", user_id).execute()
    return res.data or []


@router.get("/shared-with-me")
def shared_with_me(authorization: str | None = Header(default=None)):
    """Calendars other people have sent to me."""
    user_id = _verified_user_id(authorization)
    sb = _user_client(authorization)
    res = sb.table("calendar_shares").select("*").eq("grantee_id", user_id).execute()
    return res.data or []


@router.delete("/share/{share_id}")
def delete_share(share_id: str, authorization: str | None = Header(default=None)):
    sb = _user_client(authorization)
    try:
        sb.table("calendar_shares").delete().eq("id", share_id).execute()
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"status": "deleted"}


@router.get("/shared-events")
def shared_events(days: int = 7, start: str | None = None, authorization: str | None = Header(default=None)):
    """Live events from calendars other people have shared with me.

    Uses each SHARER's stored Google token (never the caller's) to pull just
    the one calendar they shared, read-only. Their token never leaves the
    backend.
    """
    user_id = _verified_user_id(authorization)
    sb = _user_client(authorization)
    shares = sb.table("calendar_shares").select("*").eq("grantee_id", user_id).execute().data or []

    out = []
    for share in shares:
        try:
            creds = get_credentials(share["owner_id"])
        except HTTPException:
            continue
        events = _fetch_events(creds, [share["calendar_id"]], days, start)
        for e in events:
            e["share_id"] = share["id"]
            e["label"] = share.get("label")
        out.extend(events)
    return out
