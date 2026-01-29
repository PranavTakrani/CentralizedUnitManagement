from pydantic import BaseModel
from typing import Optional
from datetime import datetime
from uuid import UUID

# --------------------
# User schemas
# --------------------
class UserCreate(BaseModel):
    email: str
    name: Optional[str] = None

class UserRead(BaseModel):
    id: UUID
    email: str
    name: Optional[str]
    created_at: datetime

    class Config:
        orm_mode = True

# --------------------
# Course schemas
# --------------------
class CourseCreate(BaseModel):
    user_id: UUID
    platform: str
    name: str
    course_code: Optional[str] = None

class CourseRead(BaseModel):
    id: UUID
    user_id: UUID
    platform: str
    name: str
    course_code: Optional[str]

    class Config:
        orm_mode = True

# --------------------
# Assignment schemas
# --------------------
class AssignmentCreate(BaseModel):
    course_id: UUID
    title: str
    platform: str
    due_at: Optional[datetime] = None
    external_id: Optional[str] = None
    url: Optional[str] = None

class AssignmentRead(BaseModel):
    id: UUID
    course_id: UUID
    title: str
    platform: str
    due_at: Optional[datetime]
    external_id: Optional[str]
    url: Optional[str]
    status: str
    last_synced: datetime

    class Config:
        orm_mode = True
