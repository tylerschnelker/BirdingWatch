"""
SQLite database operations for storing bird detections.
Uses Python's built-in sqlite3 module (no ORM).
"""

import sqlite3
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Optional

from config import DATABASE_PATH


def get_connection():
    """
    Create and return a database connection.
    """
    return sqlite3.connect(DATABASE_PATH)


def init_db():
    """
    Initialize the database by creating the detections table if it doesn't exist.
    Should be called on server startup.
    """
    conn = get_connection()
    cursor = conn.cursor()
    
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS detections (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            species_common TEXT NOT NULL,
            species_scientific TEXT NOT NULL,
            confidence REAL NOT NULL,
            audio_filename TEXT NOT NULL,
            detected_at TEXT NOT NULL,
            image_url TEXT,
            wiki_summary TEXT
        )
    """)
    
    conn.commit()
    conn.close()
    print(f"Database initialized at {DATABASE_PATH}")


def insert_detection(detection: Dict) -> int:
    """
    Insert a new detection into the database.
    
    Args:
        detection: Dictionary with keys: species_common, species_scientific,
                   confidence, audio_filename, detected_at, image_url, wiki_summary
    
    Returns:
        The ID of the newly inserted row
    """
    conn = get_connection()
    cursor = conn.cursor()
    
    cursor.execute("""
        INSERT INTO detections (
            species_common, species_scientific, confidence, 
            audio_filename, detected_at, image_url, wiki_summary
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (
        detection['species_common'],
        detection['species_scientific'],
        detection['confidence'],
        detection['audio_filename'],
        detection['detected_at'],
        detection.get('image_url'),
        detection.get('wiki_summary')
    ))
    
    row_id = cursor.lastrowid
    conn.commit()
    conn.close()
    
    return row_id


def get_recent_detections(limit: int = 50) -> List[Dict]:
    """
    Get the most recent detections, ordered by detection time (newest first).
    
    Args:
        limit: Maximum number of detections to return
    
    Returns:
        List of detection dictionaries
    """
    conn = get_connection()
    conn.row_factory = sqlite3.Row  # Enable column access by name
    cursor = conn.cursor()
    
    cursor.execute("""
        SELECT * FROM detections
        ORDER BY detected_at DESC
        LIMIT ?
    """, (limit,))
    
    rows = cursor.fetchall()
    conn.close()
    
    return [dict(row) for row in rows]


def get_species_summary() -> List[Dict]:
    """
    Get a summary of all detected species, grouped by species.
    Includes count, last seen date, and image URL.
    
    Returns:
        List of dictionaries with keys: species_common, count, last_seen, image_url
    """
    conn = get_connection()
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    cursor.execute("""
        SELECT 
            species_common,
            COUNT(*) as count,
            MAX(detected_at) as last_seen,
            MAX(image_url) as image_url
        FROM detections
        GROUP BY species_common
        ORDER BY count DESC
    """)
    
    rows = cursor.fetchall()
    conn.close()
    
    return [dict(row) for row in rows]


def get_detection_by_id(detection_id: int) -> Optional[Dict]:
    """
    Get a single detection by its ID.
    
    Args:
        detection_id: The ID of the detection to retrieve
    
    Returns:
        Detection dictionary, or None if not found
    """
    conn = get_connection()
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    cursor.execute("""
        SELECT * FROM detections WHERE id = ?
    """, (detection_id,))
    
    row = cursor.fetchone()
    conn.close()
    
    if row:
        return dict(row)
    return None


def delete_detection(detection_id: int) -> bool:
    """
    Delete a detection by its ID.
    
    Args:
        detection_id: The ID of the detection to delete
    
    Returns:
        True if deleted, False if not found
    """
    conn = get_connection()
    cursor = conn.cursor()
    
    cursor.execute("""
        DELETE FROM detections WHERE id = ?
    """, (detection_id,))
    
    deleted = cursor.rowcount > 0
    conn.commit()
    conn.close()
    
    return deleted
