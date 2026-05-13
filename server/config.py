"""
Configuration for the BirdWatch desktop server.
"""

from pathlib import Path

# Directory for uploaded audio files
UPLOAD_DIR = Path("uploads")

# SQLite database file path
DATABASE_PATH = Path("birdwatch.db")

# Server host and port
HOST = "0.0.0.0"
PORT = 8000

# BirdNET confidence threshold - only save detections above this score
BIRDNET_CONFIDENCE_THRESHOLD = 0.7

# Location coordinates for BirdNET location filtering (optional)
# Fill in your latitude and longitude for better accuracy
LAT = None
LON = None
