import os
import requests

from dotenv import load_dotenv
load_dotenv()

CANVAS_API_TOKEN = os.getenv("CANVAS_API_TOKEN")
CANVAS_BASE_URL = os.getenv("CANVAS_BASE_URL")

HEADERS = {
    "Authorization": f"Bearer {CANVAS_API_TOKEN}"
}

def get_courses():
    url = f"{CANVAS_BASE_URL}/api/v1/courses"
    params = {
        "enrollment_state": "active",
        "per_page": 100
    }
    #print("TOKEN PREFIX:", CANVAS_API_TOKEN[:10])
    #print("BASE URL:", CANVAS_BASE_URL)
    #print("HEADERS:", HEADERS)
    response = requests.get(url, headers=HEADERS, params= params)
    response.raise_for_status()
    return response.json()

def get_assignments(course_id):
    url = f"{CANVAS_BASE_URL}/api/v1/courses/{course_id}/assignments"
    params = {
        "per_page": 100
    }
    response = requests.get(url, headers=HEADERS, params=params)
    response.raise_for_status()
    return response.json()
