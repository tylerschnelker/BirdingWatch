"""
Configuration for the BirdWatch desktop server.
Loads values from .env file or uses defaults.
"""

import os
from pathlib import Path
from dotenv import load_dotenv

# Load environment variables from .env file
BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

API_KEY = os.getenv("API_KEY")

# Directory for uploaded audio files
UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", "uploads"))

# SQLite database file path
DATABASE_PATH = Path(os.getenv("DATABASE_PATH", "birdwatch.db"))

# Server host and port
HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", "8000"))

# BirdNET confidence threshold - only save detections above this score
BIRDNET_CONFIDENCE_THRESHOLD = float(os.getenv("BIRDNET_CONFIDENCE_THRESHOLD", "0.7"))

# Location coordinates for BirdNET location filtering (optional)
# Fill in your latitude and longitude for better accuracy
LAT = os.getenv("LAT")
LON = os.getenv("LON")

# Convert LAT/LON to float if provided
if LAT and LAT.lower() != "none":
    LAT = float(LAT)
if LON and LON.lower() != "none":
    LON = float(LON)
