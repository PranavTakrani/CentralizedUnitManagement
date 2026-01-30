from sqlalchemy import Boolean, Column, String, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
from database import Base
import uuid

class User(Base):
    __tablename__ = "users"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String, unique=True, nullable=False)
    name = Column(String)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class Course(Base):
    __tablename__ = "courses"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    platform = Column(String, nullable=False)
    name = Column(String, nullable=False)
    course_code = Column(String)

class Assignment(Base):
    __tablename__ = "assignments"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    course_id = Column(UUID(as_uuid=True), ForeignKey("courses.id"))
    title = Column(String, nullable=False)
    due_at = Column(DateTime)
    platform = Column(String, nullable=False)
    external_id = Column(String)
    url = Column(String)
    last_synced = Column(DateTime(timezone=True), server_default=func.now())
    status = Column(String, default="open")

class UserAssignment(Base):
    __tablename__ = "user_assignments"

    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), primary_key=True)
    assignment_id = Column(UUID(as_uuid=True), ForeignKey("assignments.id"), primary_key=True)

    checked_off = Column(Boolean, default=False)
    checked_off_at = Column(DateTime(timezone=True))
    ## submission_status = Column(String)  # optional
