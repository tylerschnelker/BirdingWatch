"""
Configuration for the Raspberry Pi audio recorder.
Loads values from .env file or uses defaults.
"""

import os
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Desktop server URL - REPLACE <DESKTOP_LOCAL_IP> with your actual local IP address
# Example: "http://192.168.1.100:8000"
DESKTOP_SERVER_URL = os.getenv("DESKTOP_SERVER_URL", "http://<DESKTOP_LOCAL_IP>:8000")

API_KEY = os.getenv("API_KEY")

# Audio recording settings
SAMPLE_RATE = int(os.getenv("SAMPLE_RATE", "48000"))
CHANNELS = int(os.getenv("CHANNELS", "1"))
SILENCE_THRESHOLD = float(os.getenv("SILENCE_THRESHOLD", "0.01"))
MIN_RECORDING_SECONDS = int(os.getenv("MIN_RECORDING_SECONDS", "3"))
MAX_RECORDING_SECONDS = int(os.getenv("MAX_RECORDING_SECONDS", "15"))

# Server endpoint for uploading audio
UPLOAD_ENDPOINT = os.getenv("UPLOAD_ENDPOINT", "/upload-audio")

# Max disk space for clips waiting to upload (e.g. during a network outage).
# Oldest clips are dropped past this. ~1.3 MB per 15s clip, so 2000 MB holds
# well over a day of continuous activity.
OUTBOX_MAX_MB = int(os.getenv("OUTBOX_MAX_MB", "2000"))

# How often the Pi checks in with the server so it can tell "alive but quiet"
# apart from "offline" and alert when the recorder goes dark.
HEARTBEAT_SECONDS = int(os.getenv("HEARTBEAT_SECONDS", "60"))
