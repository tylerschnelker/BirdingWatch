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
    
    NOTE: If schema changes, the existing birdwatch.db file must be deleted
    to recreate the table with the new schema.
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
            first_detected_at TEXT NOT NULL,
            last_detected_at TEXT NOT NULL,
            detection_count INTEGER DEFAULT 1,
            image_url TEXT,
            wiki_summary TEXT
        )
    """)
    
    conn.commit()
    conn.close()
    print(f"Database initialized at {DATABASE_PATH}")


def insert_session(detection: Dict) -> int:
    """
    Insert a new session into the database.
    
    Args:
        detection: Dictionary with keys: species_common, species_scientific,
                   confidence, audio_filename, first_detected_at, last_detected_at,
                   image_url, wiki_summary
    
    Returns:
        The ID of the newly inserted row
    """
    conn = get_connection()
    cursor = conn.cursor()
    
    cursor.execute("""
        INSERT INTO detections (
            species_common, species_scientific, confidence, 
            audio_filename, first_detected_at, last_detected_at, 
            detection_count, image_url, wiki_summary
        ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
    """, (
        detection['species_common'],
        detection['species_scientific'],
        detection['confidence'],
        detection['audio_filename'],
        detection['first_detected_at'],
        detection['last_detected_at'],
        detection.get('image_url'),
        detection.get('wiki_summary')
    ))
    
    row_id = cursor.lastrowid
    conn.commit()
    conn.close()
    
    return row_id


def get_recent_detections(limit: int = 50) -> List[Dict]:
    """
    Get the most recent sessions, ordered by last detection time (newest first).
    
    Args:
        limit: Maximum number of sessions to return
    
    Returns:
        List of session dictionaries
    """
    conn = get_connection()
    conn.row_factory = sqlite3.Row  # Enable column access by name
    cursor = conn.cursor()
    
    cursor.execute("""
        SELECT * FROM detections
        ORDER BY last_detected_at DESC
        LIMIT ?
    """, (limit,))
    
    rows = cursor.fetchall()
    conn.close()
    
    return [dict(row) for row in rows]


def get_species_summary() -> List[Dict]:
    """
    Get a summary of all detected species, grouped by species.
    Includes total sessions (visits), average detections per session,
    longest session duration, last seen date, and image URL.
    
    Returns:
        List of dictionaries with keys: species_common, total_sessions,
        avg_detections, max_duration_minutes, last_seen, image_url
    """
    conn = get_connection()
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    cursor.execute("""
        SELECT 
            species_common,
            COUNT(*) as total_sessions,
            AVG(detection_count) as avg_detections,
            MAX(
                CAST(
                    (julianday(last_detected_at) - julianday(first_detected_at)) * 24 * 60
                    AS REAL
                )
            ) as max_duration_minutes,
            MAX(last_detected_at) as last_seen,
            MAX(image_url) as image_url
        FROM detections
        GROUP BY species_common
        ORDER BY total_sessions DESC
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


def find_active_session(species_common: str, timeout_minutes: int) -> Optional[Dict]:
    """
    Find an active session for a species within the timeout window.
    
    A session is considered active if its last_detected_at is within
    timeout_minutes of the current time.
    
    Args:
        species_common: The common name of the species
        timeout_minutes: Minutes to look back for an active session
    
    Returns:
        Session dictionary if found, None otherwise
    """
    conn = get_connection()
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    # Calculate the cutoff time
    cursor.execute("""
        SELECT datetime('now', '-' || ? || ' minutes') as cutoff
    """, (timeout_minutes,))
    cutoff = cursor.fetchone()['cutoff']
    
    # Look for a session within the timeout window
    cursor.execute("""
        SELECT * FROM detections
        WHERE species_common = ? AND last_detected_at > ?
        ORDER BY last_detected_at DESC
        LIMIT 1
    """, (species_common, cutoff))
    
    row = cursor.fetchone()
    conn.close()
    
    if row:
        return dict(row)
    return None


def update_session(session_id: int, confidence: float, last_detected_at: str) -> None:
    """
    Update an existing session with new detection information.
    
    Increments detection_count by 1, updates last_detected_at,
    and updates confidence if the new confidence is higher.
    
    Args:
        session_id: The ID of the session to update
        confidence: The confidence of the new detection
        last_detected_at: ISO format timestamp of the new detection
    """
    conn = get_connection()
    cursor = conn.cursor()
    
    # Update session: increment count, update last_detected_at,
    # and update confidence only if new confidence is higher
    cursor.execute("""
        UPDATE detections
        SET detection_count = detection_count + 1,
            last_detected_at = ?,
            confidence = CASE WHEN ? > confidence THEN ? ELSE confidence END
        WHERE id = ?
    """, (last_detected_at, confidence, confidence, session_id))
    
    conn.commit()
    conn.close()
