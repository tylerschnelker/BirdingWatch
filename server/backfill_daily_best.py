"""
One-time / repeatable maintenance script.

Retroactively applies the "keep only the single highest-confidence audio clip
per species per day" retention policy to files already sitting in
UPLOAD_DIR, and (re)populates the daily_best_clips table from existing
`detections` session history. This is how disk space gets reclaimed on a
droplet that was accumulating every clip forever under the old policy.

Never modifies the `detections` table itself - only writes daily_best_clips
and deletes files. Idempotent: safe to re-run, a second run reports nothing
left to delete.

Known limitation: this reconstructs "winner per species+day" from
detections.confidence/audio_filename as they exist right now. Older rows may
already reflect the audio_filename-overwrite bug that was fixed alongside
this script, so the historical pick is best-effort, not a perfect
reconstruction of true per-clip confidence history.

Usage (run from the server/ directory):
    python backfill_daily_best.py --dry-run
    python backfill_daily_best.py --dry-run --verbose
    python backfill_daily_best.py
"""

import argparse
from collections import defaultdict
from datetime import datetime

from config import UPLOAD_DIR
from database import get_connection, get_daily_best, init_db, insert_daily_best, update_daily_best


def compute_winners():
    """
    Scan all detections rows and bucket by (species_common, local date of
    last_detected_timestamp), keeping the highest-confidence row per bucket.

    Returns:
        Dict mapping (species_common, 'YYYY-MM-DD') -> winning row dict.
    """
    conn = get_connection()
    conn.row_factory = None
    cursor = conn.cursor()
    cursor.execute("""
        SELECT id, species_common, audio_filename, confidence, last_detected_timestamp
        FROM detections
    """)

    winners = {}
    for row_id, species_common, audio_filename, confidence, last_ts in cursor.fetchall():
        if not audio_filename or last_ts is None:
            continue
        date_str = datetime.fromtimestamp(last_ts).strftime('%Y-%m-%d')
        key = (species_common, date_str)
        current = winners.get(key)
        if current is None or confidence > current['confidence']:
            winners[key] = {
                'id': row_id,
                'audio_filename': audio_filename,
                'confidence': confidence,
            }

    conn.close()
    return winners


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dry-run', action='store_true', help='Report what would happen without deleting anything or writing to the database')
    parser.add_argument('--verbose', action='store_true', help='Print per-file decisions')
    args = parser.parse_args()

    init_db()  # idempotent; ensures daily_best_clips exists

    winners = compute_winners()
    kept_filenames = {w['audio_filename'] for w in winners.values()}

    on_disk = {p.name for p in UPLOAD_DIR.glob('*.wav')}
    to_delete = sorted(on_disk - kept_filenames)
    missing_from_disk = sorted(kept_filenames - on_disk)

    total_bytes = 0
    for filename in to_delete:
        filepath = UPLOAD_DIR / filename
        try:
            total_bytes += filepath.stat().st_size
        except OSError:
            pass

    print(f"Species+day buckets found: {len(winners)}")
    print(f"Winning clips to keep: {len(kept_filenames)}")
    print(f"Files on disk: {len(on_disk)}")
    print(f"Files to delete: {len(to_delete)} ({total_bytes / (1024 * 1024):.1f} MB)")
    if missing_from_disk:
        print(f"Warning: {len(missing_from_disk)} winning clip(s) referenced in the database are not on disk (already missing): {missing_from_disk[:10]}{'...' if len(missing_from_disk) > 10 else ''}")

    if args.verbose:
        for filename in to_delete:
            print(f"  would delete: {filename}")

    if args.dry_run:
        print("\nDry run - no files deleted, no database changes made. Re-run without --dry-run to apply.")
        return

    deleted_count = 0
    for filename in to_delete:
        try:
            (UPLOAD_DIR / filename).unlink()
            deleted_count += 1
        except OSError as e:
            print(f"Could not delete {filename}: {e}")

    updated_count = 0
    inserted_count = 0
    for (species_common, date_str), winner in winners.items():
        existing = get_daily_best(species_common, date_str)
        if existing is None:
            insert_daily_best(species_common, date_str, winner['audio_filename'], winner['confidence'], winner['id'])
            inserted_count += 1
        elif existing['audio_filename'] != winner['audio_filename']:
            update_daily_best(existing['id'], winner['audio_filename'], winner['confidence'], winner['id'])
            updated_count += 1

    print(f"\nDeleted {deleted_count} file(s), reclaimed ~{total_bytes / (1024 * 1024):.1f} MB.")
    print(f"daily_best_clips: {inserted_count} inserted, {updated_count} updated.")


if __name__ == "__main__":
    main()
