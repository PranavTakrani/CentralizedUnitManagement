from fastapi import APIRouter, HTTPException
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
import os
import datetime
import pytz

import token_store

TZ = pytz.timezone("America/Los_Angeles")

router = APIRouter()

SCOPES = ["https://www.googleapis.com/auth/calendar.readonly"]

PROVIDER = "google_calendar"
TOKEN_URI = "https://oauth2.googleapis.com/token"


def get_calendar_ids():
    """Calendar IDs to pull events from, managed by the user via the frontend
    (stored in the 'calendars' Supabase table rather than hardcoded)."""
    result = (
        token_store.get_client()
        .table("calendars")
        .select("calendar_id")
        .execute()
    )
    return [row["calendar_id"] for row in (result.data or [])]


def get_credentials():
    """Build Google credentials from the refresh token stored in Supabase.

    There is no interactive fallback: on a server there is no browser to run
    an installed-app OAuth flow in. If the stored token is missing or the
    refresh fails, that is a configuration error the operator has to fix by
    re-seeding the oauth_tokens row.
    """
    client_id = os.getenv("GOOGLE_CLIENT_ID")
    client_secret = os.getenv("GOOGLE_CLIENT_SECRET")
    if not client_id or not client_secret:
        raise HTTPException(
            status_code=500,
            detail="GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not configured.",
        )

    try:
        row = token_store.get_token(PROVIDER)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Could not read stored Google token: {e}")

    if not row or not row.get("refresh_token"):
        raise HTTPException(
            status_code=500,
            detail=(
                "No Google Calendar refresh token found in the oauth_tokens table. "
                "Re-run the OAuth consent flow locally and seed the 'google_calendar' row."
            ),
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
            creds.refresh(Request())
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Google token refresh failed: {e}")
        # Cache the fresh access token so later cold starts reuse it until it
        # expires, instead of hitting Google's token endpoint every request.
        try:
            token_store.save_token(
                PROVIDER,
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

@router.get("/today")
def get_today():
    return get_events(days=1)
@router.get("/upcoming")
def get_upcoming(days: int = 7, start: str | None = None):
    return get_events(days=days, start=start)

def get_events(days=1, start=None):
    creds = get_credentials()
    service = build("calendar", "v3", credentials=creds)
    if start:
        y, mo, d = map(int, start.split("-"))
        local_midnight = TZ.localize(datetime.datetime(y, mo, d))
    else:
        local_now = datetime.datetime.now(TZ)
        local_midnight = local_now.replace(hour=0, minute=0, second=0, microsecond=0)
    time_min = local_midnight.astimezone(pytz.utc).isoformat()
    time_max = (local_midnight + datetime.timedelta(days=days)).astimezone(pytz.utc).isoformat()

    try:
        calendar_ids = get_calendar_ids()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Could not read calendar list: {e}")

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
