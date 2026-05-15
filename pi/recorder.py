"""
Continuous audio monitoring and recording for bird detection.
Fixed version: stable stream-based capture (no blocking sd.rec loop).
"""

import sounddevice as sd
import numpy as np
import requests
import wave
import os
import time
import queue
from datetime import datetime
from pathlib import Path
import sys
from config import API_KEY

from config import (
    DESKTOP_SERVER_URL,
    SAMPLE_RATE,
    SILENCE_THRESHOLD,
    MIN_RECORDING_SECONDS,
    MAX_RECORDING_SECONDS,
    UPLOAD_ENDPOINT
)

# ----------------------------
# Setup
# ----------------------------

DEVICE = 0  # LavMicro-U (confirmed from sounddevice list)
CHANNELS = 1  # FORCE mono capture (critical fix)

# RECORDING_DIR = Path("/tmp/birdwatch")
RECORDING_DIR = Path("/home/pi/birdwatch_recordings")
RECORDING_DIR.mkdir(parents=True, exist_ok=True)

audio_queue = queue.Queue()

# state
is_recording = False
recording_buffer = []
silence_counter = 0.0
SILENCE_LIMIT = 2.0  # seconds of silence to stop recording


# ----------------------------
# Audio utilities
# ----------------------------

def calculate_rms(audio_chunk):
    return np.sqrt(np.mean(audio_chunk.astype(np.float32) ** 2))


def save_wav(filename, audio_data, sample_rate):
    """
    Save mono float audio [-1,1] to WAV.
    """
    audio_int16 = np.clip(audio_data, -1, 1)
    audio_int16 = (audio_int16 * 32767).astype(np.int16)

    with wave.open(str(filename), "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(audio_int16.tobytes())


def upload_audio(filepath):
    upload_url = DESKTOP_SERVER_URL + UPLOAD_ENDPOINT

    try:
        with open(filepath, 'rb') as f:
            files = {
                'file': (os.path.basename(filepath), f, 'audio/wav')
            }
            response = requests.post(
                upload_url,
                files=files,
                timeout=30,
                headers={"x-api-key": API_KEY}
            )

        if response.status_code == 200:
            print(f"[UPLOAD OK] {filepath.name}")
            return True
        else:
            print(f"[UPLOAD FAIL] HTTP {response.status_code}")
            return False

    except Exception as e:
        print(f"[UPLOAD ERROR] {e}")
        return False


# ----------------------------
# Sounddevice callback (CRITICAL FIX)
# ----------------------------

def audio_callback(indata, frames, time, status):
    """
    This runs in real-time thread from sounddevice.
    Must be lightweight.
    """
    if status:
        print("Audio status:", status)

    audio_queue.put(indata.copy())


# ----------------------------
# Main loop
# ----------------------------

def monitor():
    global is_recording, recording_buffer, silence_counter

    print("Starting BirdWatch recorder (stream mode)...")
    print(f"Device: {DEVICE} | Sample rate: {SAMPLE_RATE} | Mono: {CHANNELS}")

    with sd.InputStream(
        device=DEVICE,
        channels=CHANNELS,
        samplerate=SAMPLE_RATE,
        callback=audio_callback,
        dtype=np.float32,
        blocksize=int(SAMPLE_RATE * 0.1)  # 100ms chunks
    ):

        while True:
            data = audio_queue.get()

            # flatten to 1D mono
            chunk = np.squeeze(data)

            rms = calculate_rms(chunk)

            # ----------------------------
            # START recording
            # ----------------------------
            if not is_recording and rms > SILENCE_THRESHOLD:
                is_recording = True
                recording_buffer = []
                silence_counter = 0.0

                print(f"[START] RMS={rms:.4f}")

            # ----------------------------
            # RECORDING STATE
            # ----------------------------
            if is_recording:
                recording_buffer.append(chunk)

                if rms < SILENCE_THRESHOLD:
                    silence_counter += 0.1
                else:
                    silence_counter = 0.0

                duration = len(recording_buffer) * 0.1

                # ----------------------------
                # STOP conditions
                # ----------------------------
                if (silence_counter >= SILENCE_LIMIT and
                        duration >= MIN_RECORDING_SECONDS):

                    is_recording = False

                    audio = np.concatenate(recording_buffer)

                    # limit max duration
                    max_samples = int(MAX_RECORDING_SECONDS * SAMPLE_RATE)
                    if len(audio) > max_samples:
                        audio = audio[:max_samples]

                    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                    filename = RECORDING_DIR / f"birdcall_{timestamp}.wav"

                    save_wav(filename, audio, SAMPLE_RATE)

                    print(f"[SAVED] {filename} ({len(audio)/SAMPLE_RATE:.1f}s)")

                    # ----------------------------
                    # Upload with retry + ALWAYS cleanup
                    # ----------------------------

                    uploaded = False

                    for attempt in range(3):
                        print(f"[UPLOAD] attempt {attempt + 1}/3")

                        if upload_audio(filename):
                            uploaded = True
                            break

                        time.sleep(2)

                    if uploaded:
                        print("[UPLOAD SUCCESS]")
                    else:
                        print("[UPLOAD FAILED AFTER RETRIES]")

                    # ALWAYS delete local temp file
                    try:
                        if filename.exists():
                            os.remove(filename)
                            print("[CLEANUP] deleted local file")
                    except Exception as e:
                        print(f"[CLEANUP ERROR] {e}")

                    recording_buffer = []
                    silence_counter = 0.0

                # max duration safety
                elif duration >= MAX_RECORDING_SECONDS:
                    is_recording = False

                    audio = np.concatenate(recording_buffer)

                    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                    filename = RECORDING_DIR / f"birdcall_{timestamp}.wav"

                    save_wav(filename, audio, SAMPLE_RATE)

                    print(f"[MAX SAVE] {filename}")

                    uploaded = False

                    for attempt in range(3):
                        print(f"[UPLOAD] attempt {attempt + 1}/3")

                        if upload_audio(filename):
                            uploaded = True
                            break

                        time.sleep(2)

                    if uploaded:
                        print("[UPLOAD SUCCESS]")
                    else:
                        print("[UPLOAD FAILED AFTER RETRIES]")

                    # ALWAYS delete local temp file
                    try:
                        if filename.exists():
                            os.remove(filename)
                            print("[CLEANUP] deleted local file")
                    except Exception as e:
                        print(f"[CLEANUP ERROR] {e}")

                    recording_buffer = []
                    silence_counter = 0.0


# ----------------------------
# Entry point
# ----------------------------

def main():
    while True:
        try:
            monitor()
        except KeyboardInterrupt:
            print("\nStopped.")
            sys.exit(0)
        except Exception as e:
            print("Fatal error:", e)
            print("Restarting in 5s...")
            import time
            time.sleep(5)


if __name__ == "__main__":
    main()