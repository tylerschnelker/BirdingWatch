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

# Audio recording settings
SAMPLE_RATE = int(os.getenv("SAMPLE_RATE", "44100"))
CHANNELS = int(os.getenv("CHANNELS", "1"))
SILENCE_THRESHOLD = float(os.getenv("SILENCE_THRESHOLD", "0.01"))
MIN_RECORDING_SECONDS = int(os.getenv("MIN_RECORDING_SECONDS", "3"))
MAX_RECORDING_SECONDS = int(os.getenv("MAX_RECORDING_SECONDS", "15"))

# Server endpoint for uploading audio
UPLOAD_ENDPOINT = os.getenv("UPLOAD_ENDPOINT", "/upload-audio")
