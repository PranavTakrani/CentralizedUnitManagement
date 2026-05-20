from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import spotify, calendar, system

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(system.router, prefix="/system")
app.include_router(spotify.router, prefix="/spotify")
app.include_router(calendar.router, prefix="/calendar")

@app.get("/")
def root():
    return {"status": "CUM is online"}