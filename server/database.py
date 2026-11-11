"""
SQLite database operations for storing bird detections.
Uses Python's built-in sqlite3 module (no ORM).
"""

import sqlite3
from datetime import datetime
import bisect
import time
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
    
    # Visits hidden as misidentifications: moved here whole (same id) so every
    # query on detections ignores them, and restoring moves them back.
    cursor.execute(f"""
        CREATE TABLE IF NOT EXISTS hidden_detections (
            id INTEGER PRIMARY KEY,
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
            last_detected_timestamp INTEGER,
            hidden_at INTEGER NOT NULL,
            hidden_reason TEXT
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

    # Web Push subscriptions (browsers that opted into "first time ever" alerts).
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS push_subscriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            endpoint TEXT NOT NULL UNIQUE,
            p256dh TEXT NOT NULL,
            auth TEXT NOT NULL,
            created_at INTEGER NOT NULL
        )
    """)

    # Cached per-species photo pool (iNaturalist) and description sections
    # (Wikipedia) that the day feed rotates through. See species_media.py.
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS species_media (
            species_common TEXT PRIMARY KEY,
            photos_json TEXT NOT NULL,
            sections_json TEXT NOT NULL,
            wiki_title TEXT,
            fetched_at INTEGER NOT NULL
        )
    """)

    conn.commit()
    conn.close()
    print(f"Database initialized at {DATABASE_PATH}")


def insert_session(detection: Dict, detected_timestamp: Optional[int] = None) -> int:
    """
    Insert a new session into the database.
    
    Args:
        detection: Dictionary with keys: species_common, species_scientific,
                   confidence, audio_filename, first_detected_at, last_detected_at,
                   detection_count (optional, defaults to 1), image_url, wiki_summary
        detected_timestamp: Unix time the clip was recorded (defaults to now).
                   Differs from now for clips the Pi buffered during an outage.
    
    Returns:
        The ID of the newly inserted row
    """
    import time
    conn = get_connection()
    cursor = conn.cursor()
    
    detection_count = detection.get('detection_count', 1)
    current_timestamp = detected_timestamp if detected_timestamp is not None else int(time.time())
    
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
            MAX(species_scientific) as species_scientific,
            COUNT(*) as total_sessions,
            AVG(detection_count) as avg_detections,
            MAX(
                CAST(
                    (last_detected_timestamp - first_detected_timestamp) / 60.0
                    AS REAL
                )
            ) as max_duration_minutes,
            MAX(last_detected_at) as last_seen,
            MAX(last_detected_timestamp) as last_seen_timestamp,
            COUNT(DISTINCT date(last_detected_timestamp, 'unixepoch', 'localtime')) as days_heard,
            MAX(image_url) as image_url
        FROM detections
        GROUP BY species_common
        ORDER BY total_sessions DESC
    """)
    
    rows = [dict(row) for row in cursor.fetchall()]

    # Each species' best recording ever: its highest-confidence kept daily clip
    cursor.execute("""
        SELECT species_common, audio_filename, detection_date, MAX(confidence)
        FROM daily_best_clips
        WHERE session_id NOT IN (SELECT id FROM hidden_detections)
        GROUP BY species_common
    """)
    best = {r[0]: (r[1], r[2]) for r in cursor.fetchall()}
    conn.close()

    for row in rows:
        row['best_audio_filename'], row['best_audio_date'] = best.get(row['species_common'], (None, None))
    return rows


# A species counts as "back" when it returns after RETURN_GAP_DAYS or more
# without being heard, and had been heard on RETURN_MIN_DAYS days before that
# (so a one-off misidentification doesn't come "back").
RETURN_GAP_DAYS = 30
RETURN_MIN_DAYS = 3


def is_return(gap_days: int, days_heard_before: int, recorder_days: int) -> bool:
    """
    recorder_days: days in the gap when anything at all was heard. Requiring
    half of them keeps a recorder outage from bringing every regular "back".
    """
    return (gap_days >= RETURN_GAP_DAYS and days_heard_before >= RETURN_MIN_DAYS
            and recorder_days >= (gap_days - 1) / 2)


def count_heard_days_between(after_ts: int, before_ts: int, conn=None) -> int:
    """Distinct local days, strictly after after_ts's day and before before_ts's day, with any detection."""
    own = conn is None
    conn = conn or get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT COUNT(DISTINCT date(last_detected_timestamp, 'unixepoch', 'localtime'))
        FROM detections
        WHERE date(last_detected_timestamp, 'unixepoch', 'localtime') > date(?, 'unixepoch', 'localtime')
          AND date(last_detected_timestamp, 'unixepoch', 'localtime') < date(?, 'unixepoch', 'localtime')
    """, (after_ts, before_ts))
    count = cursor.fetchone()[0]
    if own:
        conn.close()
    return count


def get_last_heard_before(species_common: str, before_ts: int):
    """(last heard timestamp or None, distinct local days heard) before before_ts."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT MAX(last_detected_timestamp),
               COUNT(DISTINCT date(last_detected_timestamp, 'unixepoch', 'localtime'))
        FROM detections WHERE species_common = ? AND last_detected_timestamp < ?
    """, (species_common, before_ts))
    last_ts, days = cursor.fetchone()
    conn.close()
    return last_ts, days or 0


def get_species_returns() -> Dict[str, Dict]:
    """
    Each species' most recent return after a long absence, from the local days
    it was heard: {species: {'date': 'YYYY-MM-DD', 'gap_days': n}}.
    """
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT DISTINCT species_common, date(last_detected_timestamp, 'unixepoch', 'localtime') as day
        FROM detections
        ORDER BY species_common, day
    """)
    days_by_species: Dict[str, List[str]] = {}
    all_days = set()
    for species, day in cursor.fetchall():
        days_by_species.setdefault(species, []).append(day)
        all_days.add(day)
    conn.close()
    all_days = sorted(all_days)

    returns = {}
    for species, days in days_by_species.items():
        dates = [datetime.strptime(d, '%Y-%m-%d').date() for d in days]
        for i in range(len(dates) - 1, 0, -1):
            gap = (dates[i] - dates[i - 1]).days
            if gap < RETURN_GAP_DAYS:
                continue
            between = bisect.bisect_left(all_days, days[i]) - bisect.bisect_right(all_days, days[i - 1])
            if is_return(gap, i, between):
                returns[species] = {'date': days[i], 'gap_days': gap}
                break
    return returns


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


DETECTION_COLUMNS = ("id, species_common, species_scientific, confidence, audio_filename, "
                     "first_detected_at, last_detected_at, detection_count, image_url, wiki_summary, "
                     "first_detected_timestamp, last_detected_timestamp")


def hide_detections(ids: List[int], reason: str) -> int:
    """Move visits to hidden_detections. Returns how many were hidden."""
    if not ids:
        return 0
    marks = ",".join("?" * len(ids))
    conn = get_connection()
    try:
        with conn:
            conn.execute(f"""
                INSERT INTO hidden_detections ({DETECTION_COLUMNS}, hidden_at, hidden_reason)
                SELECT {DETECTION_COLUMNS}, ?, ? FROM detections WHERE id IN ({marks})
            """, (int(time.time()), reason, *ids))
            return conn.execute(f"DELETE FROM detections WHERE id IN ({marks})", ids).rowcount
    finally:
        conn.close()


def restore_detection(detection_id: int) -> bool:
    """Move a hidden visit back into detections."""
    conn = get_connection()
    try:
        with conn:
            moved = conn.execute(f"""
                INSERT INTO detections ({DETECTION_COLUMNS})
                SELECT {DETECTION_COLUMNS} FROM hidden_detections WHERE id = ?
            """, (detection_id,)).rowcount
            conn.execute("DELETE FROM hidden_detections WHERE id = ?", (detection_id,))
            return moved > 0
    finally:
        conn.close()


def get_hidden_detections(limit: int = 100) -> List[Dict]:
    conn = get_connection()
    conn.row_factory = sqlite3.Row
    rows = conn.execute("""
        SELECT id, species_common, confidence, detection_count, last_detected_timestamp, hidden_at, hidden_reason
        FROM hidden_detections ORDER BY hidden_at DESC, last_detected_timestamp DESC LIMIT ?
    """, (limit,)).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_day_species_ids(species_common: str, start_ts: int, end_ts: int) -> List[int]:
    conn = get_connection()
    rows = conn.execute("""
        SELECT id FROM detections
        WHERE species_common = ? AND last_detected_timestamp >= ? AND last_detected_timestamp < ?
    """, (species_common, start_ts, end_ts)).fetchall()
    conn.close()
    return [r[0] for r in rows]


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


def find_active_session(species_common: str, timeout_minutes: int,
                        at_timestamp: Optional[int] = None) -> Optional[Dict]:
    """
    Find an active session for a species within the timeout window.
    
    A session is considered active if its last_detected_at is within
    timeout_minutes of at_timestamp (the clip's recording time; defaults to now).
    
    Args:
        species_common: The common name of the species
        timeout_minutes: Minutes to look back for an active session
        at_timestamp: Unix time to measure the window from (defaults to now)
    
    Returns:
        Session dictionary if found, None otherwise
    """
    import time
    conn = get_connection()
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    # Calculate cutoff time as Unix timestamp (seconds since epoch)
    current_time = at_timestamp if at_timestamp is not None else int(time.time())
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
                               detection_count_increment: int, audio_filename: str,
                               detected_timestamp: Optional[int] = None) -> None:
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
        detected_timestamp: Unix time the clip was recorded (defaults to now)
    """
    import time
    conn = get_connection()
    cursor = conn.cursor()

    current_timestamp = detected_timestamp if detected_timestamp is not None else int(time.time())

    # Update session: increment count by specified amount, update last_detected_at and
    # timestamp, and update confidence/audio_filename together only if the new
    # confidence is higher (so audio_filename always matches whichever detection
    # actually produced the stored confidence value). The last-detected time only
    # moves forward, so a late-arriving older clip can't rewind a session's end.
    cursor.execute("""
        UPDATE detections
        SET detection_count = detection_count + ?,
            last_detected_at = CASE WHEN ? >= last_detected_timestamp THEN ? ELSE last_detected_at END,
            audio_filename = CASE WHEN ? > confidence THEN ? ELSE audio_filename END,
            last_detected_timestamp = MAX(last_detected_timestamp, ?),
            confidence = CASE WHEN ? > confidence THEN ? ELSE confidence END
        WHERE id = ?
    """, (detection_count_increment, current_timestamp, last_detected_at, confidence, audio_filename,
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
        wiki_summary, all_time_sessions, is_first_ever, first_heard_timestamp,
        days_heard (distinct local days heard, up to and including this one),
        audio_filename (nullable), visits ([start_ts, end_ts] per visit, oldest first).
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
            (SELECT COUNT(*) FROM detections d2 WHERE d2.species_common = d.species_common) as all_time_sessions,
            (SELECT MIN(d3.first_detected_timestamp) FROM detections d3 WHERE d3.species_common = d.species_common) as earliest_ever_timestamp,
            (SELECT COUNT(DISTINCT date(d4.last_detected_timestamp, 'unixepoch', 'localtime'))
                FROM detections d4
                WHERE d4.species_common = d.species_common AND d4.last_detected_timestamp < ?) as days_heard,
            (SELECT MAX(d5.last_detected_timestamp) FROM detections d5
                WHERE d5.species_common = d.species_common AND d5.last_detected_timestamp < ?) as prev_heard_timestamp,
            (SELECT COUNT(DISTINCT date(d6.last_detected_timestamp, 'unixepoch', 'localtime'))
                FROM detections d6
                WHERE d6.species_common = d.species_common AND d6.last_detected_timestamp < ?) as days_heard_before
        FROM detections d
        WHERE d.last_detected_timestamp >= ? AND d.last_detected_timestamp < ?
        GROUP BY d.species_common
        ORDER BY all_time_sessions ASC, last_seen_timestamp DESC
    """, (end_ts, start_ts, start_ts, start_ts, end_ts))

    rows = [dict(row) for row in cursor.fetchall()]

    for row in rows:
        earliest = row.pop('earliest_ever_timestamp')
        row['is_first_ever'] = earliest is not None and start_ts <= earliest < end_ts
        row['first_heard_timestamp'] = earliest
        prev = row.pop('prev_heard_timestamp')
        before = row.pop('days_heard_before')
        gap = (start_ts - prev) // 86400 + 1 if prev else 0
        returned = gap >= RETURN_GAP_DAYS and is_return(gap, before, count_heard_days_between(prev, start_ts, conn))
        row['returned_after_days'] = gap if returned else None

    cursor.execute("""
        SELECT species_common, audio_filename FROM daily_best_clips
        WHERE detection_date = ? AND session_id NOT IN (SELECT id FROM hidden_detections)
    """, (detection_date,))
    audio_by_species = {row[0]: row[1] for row in cursor.fetchall()}

    # Each visit's [start, end] for the birdbath's time-of-day placement and
    # timeline. A visit that started before midnight is clamped to the day.
    cursor.execute("""
        SELECT species_common, first_detected_timestamp, last_detected_timestamp
        FROM detections
        WHERE last_detected_timestamp >= ? AND last_detected_timestamp < ?
        ORDER BY first_detected_timestamp
    """, (start_ts, end_ts))
    visits_by_species = {}
    for species, first_ts, last_ts in cursor.fetchall():
        start = max(first_ts or last_ts, start_ts)
        visits_by_species.setdefault(species, []).append([start, last_ts])

    conn.close()

    for row in rows:
        row['audio_filename'] = audio_by_species.get(row['species_common'])
        row['visits'] = visits_by_species.get(row['species_common'], [])

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


# ----------------------------------------------------------------------------
# Web Push subscriptions
# ----------------------------------------------------------------------------

def add_push_subscription(endpoint: str, p256dh: str, auth: str) -> None:
    """
    Register (or refresh) a browser's push subscription. Idempotent: a
    browser can re-subscribe with the same endpoint but rotated keys.
    """
    import time
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute("""
        INSERT INTO push_subscriptions (endpoint, p256dh, auth, created_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth
    """, (endpoint, p256dh, auth, int(time.time())))

    conn.commit()
    conn.close()


def remove_push_subscription(endpoint: str) -> bool:
    """
    Remove a push subscription by its endpoint.

    Returns:
        True if a row was deleted, False if not found.
    """
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute("DELETE FROM push_subscriptions WHERE endpoint = ?", (endpoint,))

    deleted = cursor.rowcount > 0
    conn.commit()
    conn.close()

    return deleted


def get_all_push_subscriptions() -> List[Dict]:
    """
    Get every registered push subscription.
    """
    conn = get_connection()
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    cursor.execute("SELECT * FROM push_subscriptions")
    rows = [dict(row) for row in cursor.fetchall()]
    conn.close()

    return rows


def count_all_sessions_for_species(species_common: str) -> int:
    """
    Count how many sessions (ever, across all days) exist for a species.
    Used right after inserting a brand-new session to check whether it was
    that species' very first detection ever (count == 1 means yes).
    """
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute("SELECT COUNT(*) FROM detections WHERE species_common = ?", (species_common,))
    count = cursor.fetchone()[0]
    conn.close()

    return count


# ----------------------------------------------------------------------------
# Species media cache (rotating photos/descriptions)
# ----------------------------------------------------------------------------

def get_all_species_media() -> Dict[str, Dict]:
    """
    Get every cached species_media row, keyed by species_common.
    photos_json/sections_json are left as JSON strings for the caller.
    """
    conn = get_connection()
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM species_media")
    rows = {row['species_common']: dict(row) for row in cursor.fetchall()}
    conn.close()
    return rows


def upsert_species_media(species_common: str, photos_json: str, sections_json: str,
                         wiki_title: Optional[str], fetched_at: int) -> None:
    """
    Insert or replace the cached media for one species.
    """
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO species_media (species_common, photos_json, sections_json, wiki_title, fetched_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(species_common) DO UPDATE SET
            photos_json = excluded.photos_json,
            sections_json = excluded.sections_json,
            wiki_title = excluded.wiki_title,
            fetched_at = excluded.fetched_at
    """, (species_common, photos_json, sections_json, wiki_title, fetched_at))
    conn.commit()
    conn.close()


def get_all_species_names() -> List[Dict]:
    """
    Every species ever detected, with its scientific name.
    """
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT species_common, MAX(species_scientific) FROM detections GROUP BY species_common
    """)
    rows = [{'species_common': r[0], 'species_scientific': r[1]} for r in cursor.fetchall()]
    conn.close()
    return rows
