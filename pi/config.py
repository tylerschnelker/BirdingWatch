"""
Configuration for the Raspberry Pi audio recorder.
"""

# Desktop server URL - REPLACE <DESKTOP_LOCAL_IP> with your actual local IP address
# Example: "http://192.168.1.100:8000"
DESKTOP_SERVER_URL = "http://<DESKTOP_LOCAL_IP>:8000"

# Audio recording settings
SAMPLE_RATE = 44100
CHANNELS = 1
SILENCE_THRESHOLD = 0.01   # RMS threshold below which we consider it silence
MIN_RECORDING_SECONDS = 3  # Ignore clips shorter than this
MAX_RECORDING_SECONDS = 15 # Cap clips at this length

# Server endpoint for uploading audio
UPLOAD_ENDPOINT = "/upload-audio"
