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
    import time
    from datetime import datetime
    
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
            wiki_summary TEXT,
            first_detected_timestamp INTEGER,
            last_detected_timestamp INTEGER
        )
    """)
    
    # Add timestamp columns if they don't exist (for existing databases)
    try:
        cursor.execute("ALTER TABLE detections ADD COLUMN first_detected_timestamp INTEGER")
    except sqlite3.OperationalError:
        pass  # Column already exists
    
    try:
        cursor.execute("ALTER TABLE detections ADD COLUMN last_detected_timestamp INTEGER")
    except sqlite3.OperationalError:
        pass  # Column already exists
    
    # Migrate existing rows: populate NULL timestamps from ISO strings
    cursor.execute("""
        UPDATE detections
        SET first_detected_timestamp = CAST(strftime('%s', first_detected_at) AS INTEGER),
            last_detected_timestamp = CAST(strftime('%s', last_detected_at) AS INTEGER)
        WHERE first_detected_timestamp IS NULL OR last_detected_timestamp IS NULL
    """)

    # Tracks the single audio clip being retained per species per day (the
    # highest-confidence detection of that species that day). See
    # count_daily_best_references() before ever deleting a file this table
    # might still be pointing at.
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS daily_best_clips (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            species_common TEXT NOT NULL,
            detection_date TEXT NOT NULL,
            audio_filename TEXT NOT NULL,
            confidence REAL NOT NULL,
            session_id INTEGER,
            updated_at INTEGER NOT NULL,
            UNIQUE(species_common, detection_date)
        )
    """)

    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_detections_species_last_ts
        ON detections(species_common, last_detected_timestamp)
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
                   detection_count (optional, defaults to 1), image_url, wiki_summary
    
    Returns:
        The ID of the newly inserted row
    """
    import time
    conn = get_connection()
    cursor = conn.cursor()
    
    detection_count = detection.get('detection_count', 1)
    current_timestamp = int(time.time())
    
    cursor.execute("""
        INSERT INTO detections (
            species_common, species_scientific, confidence, 
            audio_filename, first_detected_at, last_detected_at, 
            detection_count, image_url, wiki_summary,
            first_detected_timestamp, last_detected_timestamp
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        detection['species_common'],
        detection['species_scientific'],
        detection['confidence'],
        detection['audio_filename'],
        detection['first_detected_at'],
        detection['last_detected_at'],
        detection_count,
        detection.get('image_url'),
        detection.get('wiki_summary'),
        current_timestamp,
        current_timestamp
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
        ORDER BY last_detected_timestamp DESC
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
                    (last_detected_timestamp - first_detected_timestamp) / 60.0
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
    import time
    conn = get_connection()
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    # Calculate cutoff time as Unix timestamp (seconds since epoch)
    current_time = int(time.time())
    cutoff_seconds = current_time - (timeout_minutes * 60)
    
    # Look for a session within the timeout window using integer comparison
    cursor.execute("""
        SELECT * FROM detections
        WHERE species_common = ? AND last_detected_timestamp > ?
        ORDER BY last_detected_timestamp DESC
        LIMIT 1
    """, (species_common, cutoff_seconds))
    
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


def update_session_with_count(session_id: int, confidence: float, last_detected_at: str,
                               detection_count_increment: int, audio_filename: str) -> None:
    """
    Update an existing session with multiple detections from one audio file.

    Increments detection_count by the specified amount, updates last_detected_at,
    and updates confidence and audio_filename only if the new confidence is higher
    than what's currently stored. NOTE: audio_filename is informational only — the
    file it points to may later be deleted by the daily-best-clip retention logic
    (see get_daily_best/insert_daily_best/update_daily_best below). Callers reading
    a session's audio should check audio_available (derived by comparing against
    daily_best_clips), not assume this filename still exists on disk.

    Args:
        session_id: The ID of the session to update
        confidence: The max confidence from the new detections
        last_detected_at: ISO format timestamp of the new detection
        detection_count_increment: Number of detections to add to the count
        audio_filename: The filename of the newly uploaded audio file
    """
    import time
    conn = get_connection()
    cursor = conn.cursor()

    current_timestamp = int(time.time())

    # Update session: increment count by specified amount, update last_detected_at and
    # timestamp, and update confidence/audio_filename together only if the new
    # confidence is higher (so audio_filename always matches whichever detection
    # actually produced the stored confidence value).
    cursor.execute("""
        UPDATE detections
        SET detection_count = detection_count + ?,
            last_detected_at = ?,
            audio_filename = CASE WHEN ? > confidence THEN ? ELSE audio_filename END,
            last_detected_timestamp = ?,
            confidence = CASE WHEN ? > confidence THEN ? ELSE confidence END
        WHERE id = ?
    """, (detection_count_increment, last_detected_at, confidence, audio_filename,
          current_timestamp, confidence, confidence, session_id))

    conn.commit()
    conn.close()


# ----------------------------------------------------------------------------
# Daily best clip tracking
#
# Only one audio file is retained per (species, day) — whichever detection had
# the highest confidence. These functions manage that pointer; callers are
# responsible for the actual file deletion/retention decisions (see
# server/main.py's /upload-audio handler and backfill_daily_best.py).
# ----------------------------------------------------------------------------

def get_daily_best(species_common: str, detection_date: str) -> Optional[Dict]:
    """
    Get the current best-clip record for a species on a given day.

    Args:
        species_common: The common name of the species
        detection_date: Date string in 'YYYY-MM-DD' format (local server date)

    Returns:
        Dictionary with keys id, species_common, detection_date, audio_filename,
        confidence, session_id, updated_at, or None if no record exists yet.
    """
    conn = get_connection()
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    cursor.execute("""
        SELECT * FROM daily_best_clips
        WHERE species_common = ? AND detection_date = ?
    """, (species_common, detection_date))

    row = cursor.fetchone()
    conn.close()

    if row:
        return dict(row)
    return None


def insert_daily_best(species_common: str, detection_date: str, audio_filename: str,
                       confidence: float, session_id: Optional[int]) -> int:
    """
    Insert a new daily-best-clip record.

    Returns:
        The ID of the newly inserted row.
    """
    import time
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute("""
        INSERT INTO daily_best_clips (
            species_common, detection_date, audio_filename, confidence, session_id, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
    """, (species_common, detection_date, audio_filename, confidence, session_id, int(time.time())))

    row_id = cursor.lastrowid
    conn.commit()
    conn.close()

    return row_id


def update_daily_best(daily_best_id: int, audio_filename: str, confidence: float,
                       session_id: Optional[int]) -> None:
    """
    Update an existing daily-best-clip record to point at a new, better clip.
    """
    import time
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute("""
        UPDATE daily_best_clips
        SET audio_filename = ?, confidence = ?, session_id = ?, updated_at = ?
        WHERE id = ?
    """, (audio_filename, confidence, session_id, int(time.time()), daily_best_id))

    conn.commit()
    conn.close()


def count_daily_best_references(audio_filename: str, exclude_id: Optional[int] = None) -> int:
    """
    Count how many daily_best_clips rows currently point at a given filename.

    A single uploaded clip can legitimately be the retained best for more than
    one species at once (if it captured two species' calls), so this must be
    checked before physically deleting a file to avoid removing one still in use.

    Args:
        audio_filename: The filename to check
        exclude_id: Optionally exclude a specific daily_best_clips row from the
            count (e.g. the row about to be updated to point elsewhere)
    """
    conn = get_connection()
    cursor = conn.cursor()

    if exclude_id is None:
        cursor.execute("""
            SELECT COUNT(*) FROM daily_best_clips WHERE audio_filename = ?
        """, (audio_filename,))
    else:
        cursor.execute("""
            SELECT COUNT(*) FROM daily_best_clips WHERE audio_filename = ? AND id != ?
        """, (audio_filename, exclude_id))

    count = cursor.fetchone()[0]
    conn.close()

    return count


def get_daily_best_by_filename(audio_filename: str) -> Optional[Dict]:
    """
    Find the daily_best_clips record (if any) currently pointing at a filename.
    """
    conn = get_connection()
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    cursor.execute("""
        SELECT * FROM daily_best_clips WHERE audio_filename = ? LIMIT 1
    """, (audio_filename,))

    row = cursor.fetchone()
    conn.close()

    if row:
        return dict(row)
    return None


def delete_daily_best(daily_best_id: int) -> bool:
    """
    Delete a daily-best-clip record by its ID.

    Returns:
        True if a row was deleted, False if not found.
    """
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute("DELETE FROM daily_best_clips WHERE id = ?", (daily_best_id,))

    deleted = cursor.rowcount > 0
    conn.commit()
    conn.close()

    return deleted


# ----------------------------------------------------------------------------
# Day-grouped, species-grouped feed queries
# ----------------------------------------------------------------------------

def get_day_species_summary(detection_date: str, start_ts: int, end_ts: int) -> List[Dict]:
    """
    Get a species-grouped summary of sessions that occurred on a given day.

    Args:
        detection_date: 'YYYY-MM-DD' string, used to look up the day's retained
            audio clips (see daily_best_clips)
        start_ts: Unix timestamp for the start of the local day (inclusive)
        end_ts: Unix timestamp for the start of the next local day (exclusive)

    Returns:
        List of dicts (one per species detected that day) with keys:
        species_common, species_scientific, visit_count, total_calls,
        best_confidence, last_seen_at, last_seen_timestamp, image_url,
        wiki_summary, all_time_sessions, audio_filename (nullable).
        Sorted so rarer species (fewer all-time sessions) surface first, with
        more recently-seen species as the tiebreaker.
    """
    conn = get_connection()
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    cursor.execute("""
        SELECT
            d.species_common,
            MAX(d.species_scientific) as species_scientific,
            COUNT(*) as visit_count,
            SUM(d.detection_count) as total_calls,
            MAX(d.confidence) as best_confidence,
            MAX(d.last_detected_at) as last_seen_at,
            MAX(d.last_detected_timestamp) as last_seen_timestamp,
            MAX(d.image_url) as image_url,
            MAX(d.wiki_summary) as wiki_summary,
            (SELECT COUNT(*) FROM detections d2 WHERE d2.species_common = d.species_common) as all_time_sessions
        FROM detections d
        WHERE d.last_detected_timestamp >= ? AND d.last_detected_timestamp < ?
        GROUP BY d.species_common
        ORDER BY all_time_sessions ASC, last_seen_timestamp DESC
    """, (start_ts, end_ts))

    rows = [dict(row) for row in cursor.fetchall()]

    cursor.execute("""
        SELECT species_common, audio_filename FROM daily_best_clips WHERE detection_date = ?
    """, (detection_date,))
    audio_by_species = {row[0]: row[1] for row in cursor.fetchall()}

    conn.close()

    for row in rows:
        row['audio_filename'] = audio_by_species.get(row['species_common'])

    return rows


def get_day_species_visits(species_common: str, detection_date: str,
                            start_ts: int, end_ts: int) -> List[Dict]:
    """
    Get the individual visit (session) rows for one species on one day.

    Args:
        species_common: The common name of the species
        detection_date: 'YYYY-MM-DD' string, used to look up the day's retained
            audio clip
        start_ts: Unix timestamp for the start of the local day (inclusive)
        end_ts: Unix timestamp for the start of the next local day (exclusive)

    Returns:
        List of session dicts, newest first, each augmented with
        'audio_available': bool (True iff this visit's audio_filename is still
        the currently-retained clip for this species/day).
    """
    conn = get_connection()
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    cursor.execute("""
        SELECT * FROM detections
        WHERE species_common = ? AND last_detected_timestamp >= ? AND last_detected_timestamp < ?
        ORDER BY last_detected_timestamp DESC
    """, (species_common, start_ts, end_ts))

    rows = [dict(row) for row in cursor.fetchall()]
    conn.close()

    best = get_daily_best(species_common, detection_date)
    best_filename = best['audio_filename'] if best else None

    for row in rows:
        row['audio_available'] = row['audio_filename'] == best_filename

    return rows
