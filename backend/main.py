from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import spotify, calendar, shared_calendar

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# routers/system.py is intentionally not mounted: psutil/vcgencmd read local
# hardware, which does not exist in a serverless function.
app.include_router(spotify.router, prefix="/spotify")
app.include_router(calendar.router, prefix="/calendar")
app.include_router(shared_calendar.router, prefix="/shared-calendar")

@app.get("/")
def root():
    return {"status": "CUM is online"}