from fastapi import APIRouter
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
import os
import datetime
import pytz

TZ = pytz.timezone("America/Los_Angeles")

router = APIRouter()

SCOPES = ["https://www.googleapis.com/auth/calendar.readonly"]
CALENDAR_IDS = ["pranav.takrani@gmail.com", "ptakrani@andrew.cmu.edu", "pranav@northstarrobotics.ai"]

def get_credentials():
    creds = None
    if os.path.exists("token.json"):
        creds = Credentials.from_authorized_user_file("token.json", SCOPES)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file("credentials.json", SCOPES)
            creds = flow.run_local_server(port=8080)
            with open("token.json", "w") as token:
                token.write(creds.to_json())
    return creds

@router.get("/today")
def get_today():
    return get_events(days=1)
@router.get("/upcoming")
def get_upcoming():
    return get_events(days=3)

def get_events(days=1):
    creds = get_credentials()
    service = build("calendar", "v3", credentials=creds)
    local_now = datetime.datetime.now(TZ)
    local_midnight = local_now.replace(hour=0, minute=0, second=0, microsecond=0)
    time_min = local_midnight.astimezone(pytz.utc).isoformat()
    time_max = (local_midnight + datetime.timedelta(days=days)).astimezone(pytz.utc).isoformat()

    events = []
    for calendar_id in CALENDAR_IDS:
        result = service.events().list(
            calendarId=calendar_id,
            timeMin=time_min,
            timeMax=time_max,
            singleEvents=True,
            orderBy="startTime"
        ).execute()
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