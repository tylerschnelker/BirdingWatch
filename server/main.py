"""
FastAPI server for BirdWatch application.
Receives audio uploads from Pi, analyzes with BirdNET, stores in SQLite,
and serves a web UI for viewing detections.
"""

from fastapi import FastAPI, UploadFile, File, Query, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from pathlib import Path
from datetime import datetime, timedelta
from fastapi import Header
import uuid
import os

from config import (
    UPLOAD_DIR, DATABASE_PATH, HOST, PORT, API_KEY, SESSION_TIMEOUT_MINUTES,
    SINGLETON_CONFIDENCE_THRESHOLD, VAPID_PUBLIC_KEY
)
from database import (
    init_db, insert_session, find_active_session, update_session, update_session_with_count,
    get_recent_detections, get_species_summary, get_detection_by_id, delete_detection,
    get_daily_best, insert_daily_best, update_daily_best, count_daily_best_references,
    get_daily_best_by_filename, delete_daily_best, get_day_species_summary, get_day_species_visits,
    count_all_sessions_for_species, add_push_subscription, remove_push_subscription
)
from analyzer import analyze_audio, fetch_bird_info
from notifications import send_first_ever_notification

# Initialize FastAPI app
app = FastAPI(title="BirdWatch", description="Backyard bird tracking system")


@app.on_event("startup")
async def startup_event():
    """
    Initialize database and directories on server startup.
    """
    # Create uploads directory if it doesn't exist
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    
    # Initialize database
    init_db()
    
    print(f"Server starting on {HOST}:{PORT}")
    print(f"Upload directory: {UPLOAD_DIR}")
    print(f"Database: {DATABASE_PATH}")


@app.post("/upload-audio")
async def upload_audio(file: UploadFile = File(...), x_api_key: str = Header(None)):
    if x_api_key != API_KEY:
        return JSONResponse({"status": "error", "message": "Unauthorized"}, status_code=401)
    """
    Receive audio file from Raspberry Pi, analyze with BirdNET,
    and store detections in database.
    """
    try:
        # Generate unique filename if none provided
        filename = file.filename or f"{uuid.uuid4()}.wav"
        
        # Ensure .wav extension
        if not filename.endswith('.wav'):
            filename += '.wav'
        
        # Save the uploaded file
        filepath = UPLOAD_DIR / filename
        with open(filepath, 'wb') as f:
            content = await file.read()
            f.write(content)
        
        print(f"Received audio file: {filename} ({len(content)} bytes)")
        
        # Analyze the audio with BirdNET
        detections = analyze_audio(str(filepath))
        
        # Process each detection
        if len(detections) == 0:
            os.remove(filepath)
            print(f"No birds detected, deleted {filename}")
            return JSONResponse({
                "status": "ok",
                "detections_found": 0
            })

        # Group detections by species to handle multiple chirps in one file
        from collections import defaultdict
        species_detections = defaultdict(list)
        
        for detection in detections:
            species = detection['species_common']
            species_detections[species].append(detection)
        
        now_dt = datetime.now()
        now = now_dt.isoformat()
        today_date_str = now_dt.strftime('%Y-%m-%d')
        total_sessions_updated = 0
        file_claimed_as_daily_best = False

        # Process each species group
        for species, species_group in species_detections.items():
            # Calculate aggregate stats for this species in this file
            detection_count = len(species_group)
            max_confidence = max(d['confidence'] for d in species_group)
            scientific_name = species_group[0]['species_scientific']

            # Check if there's an active session for this species
            active_session = find_active_session(species, SESSION_TIMEOUT_MINUTES)

            # A species heard only once in this clip with no existing session to
            # corroborate it is more likely to be a misidentified noise (door
            # squeak, siren, etc.) than a real repeated call. Require a higher
            # confidence bar in that case; repeats in the same clip, or calls
            # that extend an already-confirmed session, use the normal threshold.
            if not active_session and detection_count == 1 and max_confidence < SINGLETON_CONFIDENCE_THRESHOLD:
                print(f"Held back low-confidence singleton: {species} (confidence: {max_confidence:.2f})")
                continue

            if active_session:
                # Update existing session: increment count by number of detections in this file
                update_session_with_count(
                    active_session['id'],
                    max_confidence,
                    now,
                    detection_count,
                    filename
                )
                session_id = active_session['id']
                print(f"Updated session for {species} (count: {active_session['detection_count'] + detection_count}, added {detection_count} calls)")
            else:
                # Create new session
                bird_info = fetch_bird_info(species, scientific_name)

                detection_record = {
                    'species_common': species,
                    'species_scientific': scientific_name,
                    'confidence': max_confidence,
                    'audio_filename': filename,
                    'first_detected_at': now,
                    'last_detected_at': now,
                    'detection_count': detection_count,
                    'image_url': bird_info['image_url'],
                    'wiki_summary': bird_info['wiki_summary']
                }

                session_id = insert_session(detection_record)
                print(f"New session started for {species} (ID: {session_id}, calls: {detection_count})")

                if count_all_sessions_for_species(species) == 1:
                    send_first_ever_notification(species, scientific_name)

            total_sessions_updated += 1

            # Only the single highest-confidence clip per species per day is kept
            # on disk. Decide whether this upload's file beats (or establishes)
            # today's kept clip for this species; if so, claim it and retire the
            # previous one. Otherwise this file gets nothing for this species.
            existing_best = get_daily_best(species, today_date_str)
            if existing_best is None:
                insert_daily_best(species, today_date_str, filename, max_confidence, session_id)
                file_claimed_as_daily_best = True
                print(f"New daily-best clip for {species} on {today_date_str}: {filename} ({max_confidence:.2f})")
            elif max_confidence > existing_best['confidence']:
                old_filename = existing_best['audio_filename']
                update_daily_best(existing_best['id'], filename, max_confidence, session_id)
                file_claimed_as_daily_best = True
                print(f"Daily-best clip for {species} on {today_date_str} updated: {filename} ({max_confidence:.2f} > {existing_best['confidence']:.2f})")
                if old_filename != filename and count_daily_best_references(old_filename) == 0:
                    try:
                        (UPLOAD_DIR / old_filename).unlink()
                        print(f"Deleted superseded clip {old_filename}")
                    except OSError as e:
                        print(f"Could not delete superseded clip {old_filename}: {e}")

        # If no species detected in this file ended up as anyone's new daily-best
        # clip, we don't need to keep the file on disk.
        if not file_claimed_as_daily_best:
            try:
                os.remove(filepath)
                print(f"Deleted {filename}: not the daily-best clip for any detected species")
            except OSError as e:
                print(f"Could not delete unclaimed clip {filename}: {e}")

        return JSONResponse({
            "status": "ok",
            "detections_found": len(detections),
            "sessions_updated": total_sessions_updated
        })
    
    except Exception as e:
        print(f"Error processing upload: {e}")
        return JSONResponse({
            "status": "error",
            "message": str(e)
        }, status_code=500)


@app.get("/api/detections")
async def get_detections(limit: int = Query(50, ge=1, le=100)):
    """
    Get recent bird detections.
    
    Query params:
        limit: Number of detections to return (default 50, max 100)
    """
    detections = get_recent_detections(limit)
    return JSONResponse(detections)


@app.get("/api/species")
async def get_species():
    """
    Get species summary with visit counts and last seen dates.
    """
    species = get_species_summary()
    return JSONResponse(species)


@app.get("/api/audio/{filename}")
async def get_audio(filename: str):
    """
    Serve an uploaded audio file.
    """
    filepath = UPLOAD_DIR / filename
    
    if not filepath.exists():
        return JSONResponse({
            "status": "error",
            "message": "File not found"
        }, status_code=404)
    
    return FileResponse(filepath, media_type="audio/wav")


@app.get("/api/detections/{detection_id}")
async def get_detection(detection_id: int):
    """
    Get a single detection by ID.
    """
    detection = get_detection_by_id(detection_id)
    
    if detection is None:
        return JSONResponse({
            "status": "error",
            "message": "Detection not found"
        }, status_code=404)
    
    return JSONResponse(detection)


@app.delete("/api/detections/{detection_id}")
async def delete_detection_endpoint(detection_id: int):
    """
    Delete a detection (visit) by ID. If its audio clip was the retained
    daily-best clip for that species/day, retire that pointer too and delete
    the file if nothing else still references it.
    """
    detection = get_detection_by_id(detection_id)

    if detection is None:
        return JSONResponse({
            "status": "error",
            "message": "Detection not found"
        }, status_code=404)

    delete_detection(detection_id)

    best = get_daily_best_by_filename(detection['audio_filename'])
    if best is not None:
        delete_daily_best(best['id'])
        if count_daily_best_references(detection['audio_filename']) == 0:
            try:
                (UPLOAD_DIR / detection['audio_filename']).unlink()
            except OSError as e:
                print(f"Could not delete clip {detection['audio_filename']} after visit delete: {e}")

    return JSONResponse({
        "status": "ok",
        "message": "Detection deleted"
    })


@app.get("/api/today")
async def get_today():
    """
    Server's local date, so the frontend can anchor day-navigation to the
    server's timezone rather than the viewing browser's.
    """
    return JSONResponse({"date": datetime.now().strftime('%Y-%m-%d')})


def _parse_local_day(date_str: str):
    """
    Parse a 'YYYY-MM-DD' string into local-day Unix timestamp bounds
    [start_ts, end_ts). Returns None if the string can't be parsed.
    """
    try:
        day_start = datetime.strptime(date_str, '%Y-%m-%d')
    except ValueError:
        return None
    start_ts = int(day_start.timestamp())
    end_ts = int((day_start + timedelta(days=1)).timestamp())
    return start_ts, end_ts


@app.get("/api/days/{date}")
async def get_day_summary(date: str):
    """
    Get a species-grouped summary of detections for one local day.
    """
    bounds = _parse_local_day(date)
    if bounds is None:
        return JSONResponse({
            "status": "error",
            "message": "Invalid date format, expected YYYY-MM-DD"
        }, status_code=400)

    start_ts, end_ts = bounds
    species = get_day_species_summary(date, start_ts, end_ts)
    return JSONResponse({"date": date, "species": species})


@app.get("/api/days/{date}/species/{species_common}")
async def get_day_species_visits_endpoint(date: str, species_common: str):
    """
    Get the individual visits for one species on one local day.
    """
    bounds = _parse_local_day(date)
    if bounds is None:
        return JSONResponse({
            "status": "error",
            "message": "Invalid date format, expected YYYY-MM-DD"
        }, status_code=400)

    start_ts, end_ts = bounds
    visits = get_day_species_visits(species_common, date, start_ts, end_ts)
    return JSONResponse({"species_common": species_common, "date": date, "visits": visits})


@app.get("/api/push/vapid-public-key")
async def get_vapid_public_key():
    """
    Get the VAPID public key the frontend needs to create a push subscription.
    Kept in one place (server config) instead of hardcoded in the frontend.
    """
    if not VAPID_PUBLIC_KEY:
        return JSONResponse({
            "status": "error",
            "message": "Push notifications are not configured on this server"
        }, status_code=503)

    return JSONResponse({"publicKey": VAPID_PUBLIC_KEY})


@app.post("/api/push/subscribe")
async def subscribe_push(request: Request):
    """
    Register a browser's push subscription. Body is the standard
    PushSubscription.toJSON() shape: {endpoint, keys: {p256dh, auth}}.
    Idempotent - re-subscribing with the same endpoint just refreshes keys.
    """
    body = await request.json()
    endpoint = body.get("endpoint")
    keys = body.get("keys", {})
    p256dh = keys.get("p256dh")
    auth = keys.get("auth")

    if not endpoint or not p256dh or not auth:
        return JSONResponse({"status": "error", "message": "Invalid subscription payload"}, status_code=400)

    add_push_subscription(endpoint, p256dh, auth)
    return JSONResponse({"status": "ok"})


@app.delete("/api/push/subscribe")
async def unsubscribe_push(request: Request):
    """
    Remove a browser's push subscription (user disabled notifications, or the
    browser reports the subscription is no longer valid).
    """
    body = await request.json()
    endpoint = body.get("endpoint")

    if not endpoint:
        return JSONResponse({"status": "error", "message": "Missing endpoint"}, status_code=400)

    remove_push_subscription(endpoint)
    return JSONResponse({"status": "ok"})


# Mount static files (web UI)
# We'll mount the web/ directory as static files
web_dir = Path(__file__).parent.parent / "web"
app.mount("/static", StaticFiles(directory=str(web_dir)), name="static")


@app.get("/")
async def serve_index():
    """
    Serve the main web UI at the root route.

    Explicit no-cache: without this, FileResponse sets no Cache-Control
    header at all, so browsers apply their own heuristic caching - the
    service worker's self-healing/update logic lives INSIDE this file, so if
    the browser never re-fetches it, that logic never gets a chance to run.
    This is especially sticky for phones with the site added to the home
    screen. Always revalidate with the server instead.
    """
    index_path = web_dir / "index.html"
    return FileResponse(index_path, headers={"Cache-Control": "no-cache"})


@app.get("/sw.js")
async def serve_service_worker():
    """
    Serve the service worker from the root path (not /static/sw.js) so its
    default scope covers the whole site. A service worker's default scope is
    the directory of its own URL - registering it from under /static/ meant
    it could only ever control requests already under /static/, never the
    app's actual pages, silently making all of its caching logic inert.

    Explicit no-cache for the same reason as "/" above - browsers do treat
    service worker scripts somewhat specially for update checks, but that
    shouldn't be relied on alone across all browsers/versions.
    """
    return FileResponse(web_dir / "sw.js", media_type="application/javascript", headers={"Cache-Control": "no-cache"})


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=HOST, port=PORT)
