# routers/system.py (and same pattern for spotify.py, calendar.py)
from fastapi import APIRouter
import psutil
import subprocess

router = APIRouter()

def get_cpu():
    return psutil.cpu_percent(interval = 1)

def get_ram_used():
    return psutil.virtual_memory().used

def get_ram_total():
    return psutil.virtual_memory().total

def get_ram_percent():
    return (get_ram_used()/get_ram_total())*100

def get_temp():
    try:
        result = subprocess.run(["vcgencmd", "measure_temp"], capture_output=True, text=True)
        return float(result.stdout.replace("temp=", "").replace("\'C", ""))
    except Exception:
        return None

@router.get("/")
def get_stats():
    return {
        "cpu_percent": get_cpu(),
        "ram_percent": get_ram_percent(),
        "ram_used": get_ram_used(),
        "ram_total": get_ram_total(),
        "temp": get_temp()
    }