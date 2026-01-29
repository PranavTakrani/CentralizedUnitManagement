from fastapi import FastAPI, Depends, HTTPException
from sqlalchemy.orm import Session
from database import get_db
from models import User, Course, Assignment
from schemas import UserCreate, UserRead, CourseCreate, CourseRead, AssignmentCreate, AssignmentRead
from typing import List

app = FastAPI(title="CUM Backend")

# --------------------
# Root
# --------------------
@app.get("/")
def root():
    return {"message": "Hello, CUM!"}

# --------------------
# Users
# --------------------
@app.post("/users/", response_model=UserRead)
def create_user(user: UserCreate, db: Session = Depends(get_db)):
    db_user = User(email=user.email, name=user.name)
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user

@app.get("/users/", response_model=List[UserRead])
def get_users(db: Session = Depends(get_db)):
    return db.query(User).all()

# --------------------
# Courses
# --------------------
@app.post("/courses/", response_model=CourseRead)
def create_course(course: CourseCreate, db: Session = Depends(get_db)):
    db_course = Course(**course.dict())
    db.add(db_course)
    db.commit()
    db.refresh(db_course)
    return db_course

@app.get("/courses/", response_model=List[CourseRead])
def get_courses(db: Session = Depends(get_db)):
    return db.query(Course).all()

# --------------------
# Assignments
# --------------------
@app.post("/assignments/", response_model=AssignmentRead)
def create_assignment(assign: AssignmentCreate, db: Session = Depends(get_db)):
    db_assign = Assignment(**assign.dict())
    db.add(db_assign)
    db.commit()
    db.refresh(db_assign)
    return db_assign

@app.get("/assignments/", response_model=List[AssignmentRead])
def get_assignments(db: Session = Depends(get_db)):
    return db.query(Assignment).all()
