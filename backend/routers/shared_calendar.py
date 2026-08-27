"""Shared-calendar API — backend-sourced (NOT Google).

Unlike routers/calendar.py (which pulls from Google via service_role), these
endpoints serve calendars/events stored in our own Supabase, and they are
scoped to the calling user.

Security: we do NOT use the service_role key here (that would bypass RLS).
Instead we read the caller's Supabase JWT from the Authorization header and
build a per-request client authenticated AS that user, so Postgres RLS
enforces "members only" exactly like the direct-from-frontend path would.
"""

import os

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel
from supabase import create_client, Client

router = APIRouter()


def _user_client(authorization: str | None) -> Client:
    """Build a Supabase client authenticated as the calling user.

    The frontend sends `Authorization: Bearer <supabase_access_token>`. We use
    the anon/publishable key for the client and attach the user's JWT so all
    queries run under that user's RLS context.
    """
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = authorization.split(" ", 1)[1].strip()

    url = os.getenv("SUPABASE_URL")
    anon = os.getenv("SUPABASE_ANON_KEY")
    if not url or not anon:
        raise HTTPException(
            status_code=500,
            detail="SUPABASE_URL / SUPABASE_ANON_KEY must be set for shared calendars.",
        )

    client = create_client(url, anon)
    # Route all PostgREST calls through the user's JWT so RLS applies.
    client.postgrest.auth(token)
    return client


class CalendarIn(BaseModel):
    name: str
    color: str = "#cc0000"


class EventIn(BaseModel):
    calendar_id: str
    title: str
    starts_at: str  # ISO 8601
    ends_at: str
    location: str | None = None


class MemberIn(BaseModel):
    calendar_id: str
    email: str


@router.get("/list")
def list_calendars(authorization: str | None = Header(default=None)):
    """All shared calendars the caller is a member of (RLS-scoped)."""
    sb = _user_client(authorization)
    try:
        res = sb.table("shared_calendars").select("*").order("created_at").execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return res.data or []


@router.post("/create")
def create_calendar(body: CalendarIn, authorization: str | None = Header(default=None)):
    sb = _user_client(authorization)
    try:
        res = sb.table("shared_calendars").insert(
            {"name": body.name, "color": body.color}
        ).execute()
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    return (res.data or [None])[0]


@router.delete("/{calendar_id}")
def delete_calendar(calendar_id: str, authorization: str | None = Header(default=None)):
    sb = _user_client(authorization)
    try:
        sb.table("shared_calendars").delete().eq("id", calendar_id).execute()
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"status": "deleted"}


@router.get("/events")
def list_events(
    calendar_id: str | None = None,
    authorization: str | None = Header(default=None),
):
    """Events across the caller's shared calendars, or one calendar if given."""
    sb = _user_client(authorization)
    try:
        q = sb.table("shared_calendar_events").select("*")
        if calendar_id:
            q = q.eq("calendar_id", calendar_id)
        res = q.order("starts_at").execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return res.data or []


@router.post("/events")
def create_event(body: EventIn, authorization: str | None = Header(default=None)):
    sb = _user_client(authorization)
    try:
        res = sb.table("shared_calendar_events").insert(
            {
                "calendar_id": body.calendar_id,
                "title": body.title,
                "starts_at": body.starts_at,
                "ends_at": body.ends_at,
                "location": body.location,
            }
        ).execute()
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    return (res.data or [None])[0]


@router.delete("/events/{event_id}")
def delete_event(event_id: str, authorization: str | None = Header(default=None)):
    sb = _user_client(authorization)
    try:
        sb.table("shared_calendar_events").delete().eq("id", event_id).execute()
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"status": "deleted"}


@router.post("/members")
def add_member(body: MemberIn, authorization: str | None = Header(default=None)):
    """Owner-only: add a member by email (enforced by the RPC + RLS)."""
    sb = _user_client(authorization)
    try:
        sb.rpc(
            "add_shared_calendar_member",
            {"p_calendar": body.calendar_id, "p_email": body.email},
        ).execute()
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"status": "added"}
