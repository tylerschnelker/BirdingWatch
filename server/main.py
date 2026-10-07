"""
FastAPI server for BirdWatch application.
Receives audio uploads from Pi, analyzes with BirdNET, stores in SQLite,
and serves a web UI for viewing detections.
"""

from fastapi import FastAPI, UploadFile, File, Query, Request, Body
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from pathlib import Path
from datetime import datetime, timedelta
from fastapi import Header
import uuid
import os
import re
import time
import asyncio

from config import (
    UPLOAD_DIR, DATABASE_PATH, HOST, PORT, API_KEY, SESSION_TIMEOUT_MINUTES,
    SINGLETON_CONFIDENCE_THRESHOLD, VAPID_PUBLIC_KEY, RECORDER_OFFLINE_MINUTES
)
from database import (
    init_db, insert_session, find_active_session, update_session, update_session_with_count,
    get_recent_detections, get_species_summary, get_detection_by_id, delete_detection,
    get_daily_best, insert_daily_best, update_daily_best, count_daily_best_references,
    get_daily_best_by_filename, delete_daily_best, get_day_species_summary, get_day_species_visits,
    count_all_sessions_for_species, add_push_subscription, remove_push_subscription
)
from analyzer import analyze_audio, fetch_bird_info
from notifications import send_first_ever_notification, send_push
from species_media import start_background_refresh, request_refresh, apply_daily_media

# Initialize FastAPI app
app = FastAPI(title="BirdWatch", description="Backyard bird tracking system")

# Recorder health, in memory only (resets on server restart - the Pi re-reports
# within a minute). "last_recording_evidence" is the last time we had proof the
# Pi was actually capturing audio: an upload, or a heartbeat whose mic audio was
# fresh. A heartbeat alone only proves the Pi is online.
recorder_state = {
    "last_contact": None,
    "last_recording_evidence": None,
    "pending_clips": None,
    "offline_alert_sent": False,
    "started_at": time.time(),
}

# The Pi names clips birdcall_YYYYMMDD_HHMMSS[_N].wav in its local time (same
# timezone as this server). Clips buffered on the Pi during an outage arrive
# late, so we date detections by this rather than by arrival time.
CLIP_TIME_RE = re.compile(r"birdcall_(\d{8}_\d{6})")
MAX_CLIP_AGE_SECONDS = 7 * 24 * 3600


def recorded_time_for(filename: str) -> datetime:
    """When the clip was recorded, falling back to now if the name doesn't say or looks wrong."""
    now = datetime.now()
    match = CLIP_TIME_RE.search(filename)
    if match:
        try:
            recorded = datetime.strptime(match.group(1), "%Y%m%d_%H%M%S")
            age = (now - recorded).total_seconds()
            if -300 <= age <= MAX_CLIP_AGE_SECONDS:
                return min(recorded, now)
        except ValueError:
            pass
    return now


def note_recorder_activity(recording: bool) -> None:
    now = time.time()
    recorder_state["last_contact"] = now
    if recording:
        recorder_state["last_recording_evidence"] = now


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

    asyncio.create_task(watch_recorder_health())
    start_background_refresh()


async def watch_recorder_health():
    """
    Push an alert when the recorder goes quiet for RECORDER_OFFLINE_MINUTES,
    and another when it comes back. Right after a server restart we have no
    history, so the clock starts from startup rather than alerting immediately.
    """
    threshold = RECORDER_OFFLINE_MINUTES * 60
    while True:
        await asyncio.sleep(60)
        try:
            evidence = recorder_state["last_recording_evidence"] or recorder_state["started_at"]
            silent_for = time.time() - evidence

            if silent_for > threshold and not recorder_state["offline_alert_sent"]:
                recorder_state["offline_alert_sent"] = True
                contact = recorder_state["last_contact"]
                if contact and time.time() - contact < 5 * 60:
                    body = "The Pi is online but its microphone isn't capturing audio. Check the USB mic."
                else:
                    body = f"No contact from the backyard recorder for over {RECORDER_OFFLINE_MINUTES} minutes. It may be off or off Wi-Fi."
                print(f"Recorder offline alert: {body}")
                await asyncio.to_thread(send_push, "Recorder offline", body)

            elif silent_for <= threshold and recorder_state["offline_alert_sent"]:
                recorder_state["offline_alert_sent"] = False
                print("Recorder back online")
                await asyncio.to_thread(send_push, "Recorder back online", "The backyard recorder is capturing audio again.")
        except Exception as e:
            print(f"Recorder health check error: {e}")


@app.post("/upload-audio")
async def upload_audio(file: UploadFile = File(...), x_api_key: str = Header(None)):
    if x_api_key != API_KEY:
        return JSONResponse({"status": "error", "message": "Unauthorized"}, status_code=401)
    """
    Receive audio file from Raspberry Pi, analyze with BirdNET,
    and store detections in database.
    """
    note_recorder_activity(recording=True)
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
        
        # "now" here means when the clip was recorded, which is earlier than
        # arrival for clips the Pi buffered while offline.
        now_dt = recorded_time_for(filename)
        now = now_dt.isoformat()
        now_ts = int(now_dt.timestamp())
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
            active_session = find_active_session(species, SESSION_TIMEOUT_MINUTES, now_ts)

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
                    filename,
                    now_ts
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

                session_id = insert_session(detection_record, now_ts)
                print(f"New session started for {species} (ID: {session_id}, calls: {detection_count})")

                if count_all_sessions_for_species(species) == 1:
                    send_first_ever_notification(species, scientific_name)
                    request_refresh(species, scientific_name)

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


@app.post("/api/heartbeat")
async def heartbeat(payload: dict = Body(default={}), x_api_key: str = Header(None)):
    """Periodic check-in from the Pi, sent even when nothing is being recorded."""
    if x_api_key != API_KEY:
        return JSONResponse({"status": "error", "message": "Unauthorized"}, status_code=401)

    seconds_since_audio = payload.get("seconds_since_audio")
    mic_ok = isinstance(seconds_since_audio, (int, float)) and seconds_since_audio < 60
    note_recorder_activity(recording=mic_ok)
    recorder_state["pending_clips"] = payload.get("pending_clips")
    return {"status": "ok"}


@app.get("/api/recorder-status")
async def recorder_status():
    now = time.time()
    contact = recorder_state["last_contact"]
    evidence = recorder_state["last_recording_evidence"]
    return {
        "seconds_since_contact": round(now - contact) if contact else None,
        "seconds_since_recording": round(now - evidence) if evidence else None,
        "pending_clips": recorder_state["pending_clips"],
        "offline_after_seconds": RECORDER_OFFLINE_MINUTES * 60,
    }


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
    apply_daily_media(species, datetime.now().strftime('%Y-%m-%d'))
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
    apply_daily_media(species, date)
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
