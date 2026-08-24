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
BIRDNET_CONFIDENCE_THRESHOLD = float(os.getenv("BIRDNET_CONFIDENCE_THRESHOLD", "0.5"))

# Stricter confidence threshold required for a species heard only once in an
# uploaded clip with no existing active session (i.e. nothing corroborating it).
# Repeated calls in the same clip, or calls that extend an already-confirmed
# session, only need to clear BIRDNET_CONFIDENCE_THRESHOLD.
SINGLETON_CONFIDENCE_THRESHOLD = float(os.getenv("SINGLETON_CONFIDENCE_THRESHOLD", "0.85"))

# Location coordinates for BirdNET location filtering (optional)
# Fill in your latitude and longitude for better accuracy
LAT = os.getenv("LAT")
LON = os.getenv("LON")

# Convert LAT/LON to float if provided
if LAT and LAT.lower() != "none":
    LAT = float(LAT)
if LON and LON.lower() != "none":
    LON = float(LON)

# Session timeout for grouping repeated detections (in minutes)
# If the same species is detected within this window, it updates the existing session
SESSION_TIMEOUT_MINUTES = int(os.getenv("SESSION_TIMEOUT_MINUTES", "10"))

# Web Push (VAPID) keys for "first time ever species" notifications. All
# default to None - the feature no-ops gracefully if unconfigured rather than
# crashing anything. Generate once with py_vapid and never regenerate after
# subscribers exist, since a key change invalidates every existing subscription.
VAPID_PRIVATE_KEY = os.getenv("VAPID_PRIVATE_KEY")
VAPID_PUBLIC_KEY = os.getenv("VAPID_PUBLIC_KEY")
VAPID_CLAIM_EMAIL = os.getenv("VAPID_CLAIM_EMAIL")