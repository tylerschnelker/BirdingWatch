"""
FastAPI server for BirdWatch application.
Receives audio uploads from Pi, analyzes with BirdNET, stores in SQLite,
and serves a web UI for viewing detections.
"""

from fastapi import FastAPI, UploadFile, File, Query
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from pathlib import Path
from datetime import datetime
from fastapi import Header
import uuid
import os

from config import UPLOAD_DIR, DATABASE_PATH, HOST, PORT, API_KEY, SESSION_TIMEOUT_MINUTES
from database import init_db, insert_session, find_active_session, update_session, get_recent_detections, get_species_summary, get_detection_by_id, delete_detection
from analyzer import analyze_audio, fetch_bird_info

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
            # os.remove(filepath)
            pass
            print(f"No birds detected, deleted {filename}")
            return JSONResponse({
                "status": "ok",
                "detections_found": 0
            })

        for detection in detections:
            species = detection['species_common']
            confidence = detection['confidence']
            now = datetime.now().isoformat()
            
            # Check if there's an active session for this species
            active_session = find_active_session(species, SESSION_TIMEOUT_MINUTES)
            
            if active_session:
                # Update existing session
                update_session(active_session['id'], confidence, now)
                print(f"Updated session for {species} (count: {active_session['detection_count'] + 1})")
            else:
                # Create new session
                bird_info = fetch_bird_info(species)
                
                detection_record = {
                    'species_common': species,
                    'species_scientific': detection['species_scientific'],
                    'confidence': confidence,
                    'audio_filename': filename,
                    'first_detected_at': now,
                    'last_detected_at': now,
                    'image_url': bird_info['image_url'],
                    'wiki_summary': bird_info['wiki_summary']
                }
                
                session_id = insert_session(detection_record)
                print(f"New session started for {species} (ID: {session_id})")
        
        return JSONResponse({
            "status": "ok",
            "detections_found": len(detections)
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
    Delete a detection by ID.
    """
    deleted = delete_detection(detection_id)
    
    if not deleted:
        return JSONResponse({
            "status": "error",
            "message": "Detection not found"
        }, status_code=404)
    
    return JSONResponse({
        "status": "ok",
        "message": "Detection deleted"
    })


# Mount static files (web UI)
# We'll mount the web/ directory as static files
web_dir = Path(__file__).parent.parent / "web"
app.mount("/static", StaticFiles(directory=str(web_dir)), name="static")


@app.get("/")
async def serve_index():
    """
    Serve the main web UI at the root route.
    """
    index_path = web_dir / "index.html"
    return FileResponse(index_path)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=HOST, port=PORT)
