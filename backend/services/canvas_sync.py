from database import SessionLocal
from models import Assignment, Course
from services.canvas_client import get_courses, get_assignments
from datetime import datetime, timezone

def canvas_assignment_status(assignment_json):
    lock_at = assignment_json.get("lock_at")
    if lock_at:
        lock_dt = datetime.fromisoformat(lock_at.replace("Z", "+00:00"))
        if datetime.now(timezone.utc) > lock_dt:
            return "closed"
    return "open"

def sync_canvas_assignments(user_id):
    db = SessionLocal()
    courses = db.query(Course).filter(Course.user_id == user_id, Course.platform=="canvas").all()
    
    for course in courses:
        canvas_assignments = get_assignments(course.external_id)
        
        for a in canvas_assignments:
            # Check if assignment already exists by external_id + course
            existing = db.query(Assignment).filter(
                Assignment.course_id == course.id,
                Assignment.external_id == str(a['id'])
            ).first()
            
            if existing:
                # Optional: update last_synced and status only
                existing.last_synced = datetime.now(timezone.utc)
                existing.status = canvas_assignment_status(a)
                db.add(existing)
            else:
                new_assignment = Assignment(
                    course_id=course.id,
                    title=a['name'],
                    due_at=a['due_at'],
                    platform="canvas",
                    external_id=str(a['id']),
                    url=a['html_url'],
                    status=canvas_assignment_status(a)
                )
                db.add(new_assignment)
    db.commit()
    db.close()
