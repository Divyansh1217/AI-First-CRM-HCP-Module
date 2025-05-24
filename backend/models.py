# backend/models.py
from sqlalchemy import Column, Integer, String, Date, Text, DateTime, Time
from sqlalchemy.dialects.mysql import JSON # Import JSON for MySQL-specific JSON type
from datetime import datetime

# Import Base from database.py
from database import Base

class InteractionLogDB(Base):
    __tablename__ = "interaction_logs" # Name of the table in your MySQL database

    id = Column(Integer, primary_key=True, index=True)
    hcpName = Column(String(255), index=True, nullable=False)
    interactionDate = Column(Date, nullable=False)
    interactionTime = Column(Time, nullable=True) # Stored as Python time object
    interactionType = Column(String(100), nullable=True, default="Meeting")
    attendees = Column(JSON, nullable=True) # Stores list of strings as JSON
    topicsDiscussed = Column(Text, nullable=False)
    materialsShared = Column(JSON, nullable=True) # Stores list of strings as JSON
    samplesDistributed = Column(JSON, nullable=True) # Stores list of strings as JSON
    hcpSentiment = Column(String(100), nullable=True)
    outcomes = Column(Text, nullable=True)
    followUpActions = Column(Text, nullable=True)
    timestamp = Column(DateTime, default=datetime.utcnow) # Automatically record creation time

    def __repr__(self):
        return f"<InteractionLogDB(id={self.id}, hcpName='{self.hcpName}', date='{self.interactionDate}')>"