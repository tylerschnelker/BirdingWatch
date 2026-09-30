"""
Continuous audio monitoring and recording for bird detection.

Recording and uploading are decoupled: the audio loop only ever saves clips
into RECORDING_DIR (the "outbox"), and a background thread uploads them
oldest-first, deleting each one only once the server has accepted it. A flaky
or dead network therefore never stops recording - clips queue up on disk and
drain when connectivity returns (the server dates each clip by the timestamp
in its filename, not by when it arrives).
"""

import sounddevice as sd
import numpy as np
import requests
import wave
import os
import time
import queue
import threading
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
    UPLOAD_ENDPOINT,
    OUTBOX_MAX_MB,
    HEARTBEAT_SECONDS
)

# systemd captures stdout through a pipe, which Python block-buffers by
# default - without this, nothing shows up in `journalctl -u birdwatch-recorder`
# until several KB of output have accumulated.
sys.stdout.reconfigure(line_buffering=True)

# ----------------------------
# Setup
# ----------------------------

DEVICE = 0  # LavMicro-U (confirmed from sounddevice list)
CHANNELS = 1  # FORCE mono capture (critical fix)

# RECORDING_DIR = Path("/tmp/birdwatch")
RECORDING_DIR = Path("/home/pi/birdwatch_recordings")
RECORDING_DIR.mkdir(parents=True, exist_ok=True)

# If the USB mic drops off the bus, the stream callback silently stops firing.
AUDIO_STALL_SECONDS = 10

audio_queue = queue.Queue()

# state
is_recording = False
recording_buffer = []
silence_counter = 0.0
SILENCE_LIMIT = 2.0  # seconds of silence to stop recording

# Unix time of the last audio block received from the mic, reported in heartbeats.
last_audio_time = 0.0


# ----------------------------
# Audio utilities
# ----------------------------

def calculate_rms(audio_chunk):
    return np.sqrt(np.mean(audio_chunk.astype(np.float32) ** 2))


def save_wav(filename, audio_data, sample_rate):
    """
    Save mono float audio [-1,1] to WAV.

    Writes to a .part file and renames it into place so the uploader thread
    never picks up a half-written clip.
    """
    audio_int16 = np.clip(audio_data, -1, 1)
    audio_int16 = (audio_int16 * 32767).astype(np.int16)

    tmp_path = Path(str(filename) + ".part")
    with wave.open(str(tmp_path), "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(audio_int16.tobytes())
    os.replace(tmp_path, filename)


def save_clip(audio):
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = RECORDING_DIR / f"birdcall_{timestamp}.wav"
    # Two clips finishing within the same second would otherwise overwrite each other.
    suffix = 1
    while filename.exists():
        filename = RECORDING_DIR / f"birdcall_{timestamp}_{suffix}.wav"
        suffix += 1

    save_wav(filename, audio, SAMPLE_RATE)
    print(f"[SAVED] {filename.name} ({len(audio)/SAMPLE_RATE:.1f}s)")


# ----------------------------
# Upload (background thread)
# ----------------------------

# Upload outcomes
UPLOADED = "uploaded"      # server accepted it - delete locally
REJECTED = "rejected"      # server will never accept this file - delete locally
RETRY = "retry"            # network/server trouble - keep it and try again later


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
                timeout=(10, 120),  # (connect, read) - BirdNET analysis can take a while
                headers={"x-api-key": API_KEY}
            )

        if response.status_code == 200:
            print(f"[UPLOAD OK] {filepath.name}")
            return UPLOADED
        if response.status_code in (400, 413, 415, 422):
            # Retrying an identical file can't change these answers; keeping it
            # would just block the queue behind it forever.
            print(f"[UPLOAD REJECTED] {filepath.name}: HTTP {response.status_code}, dropping")
            return REJECTED
        print(f"[UPLOAD FAIL] {filepath.name}: HTTP {response.status_code}")
        return RETRY

    except Exception as e:
        print(f"[UPLOAD ERROR] {filepath.name}: {e}")
        return RETRY


def pending_clips():
    """Clips waiting to upload, oldest first."""
    return sorted(RECORDING_DIR.glob("birdcall_*.wav"), key=lambda p: p.stat().st_mtime)


def enforce_outbox_limit(clips):
    """
    During a long outage, drop the oldest clips once the outbox exceeds
    OUTBOX_MAX_MB, so the SD card can never fill up. Returns the survivors.
    """
    limit_bytes = OUTBOX_MAX_MB * 1024 * 1024
    sizes = [p.stat().st_size for p in clips]
    total = sum(sizes)
    dropped = 0
    while clips and total > limit_bytes:
        total -= sizes.pop(0)
        try:
            clips.pop(0).unlink()
            dropped += 1
        except OSError:
            pass
    if dropped:
        print(f"[OUTBOX FULL] dropped {dropped} oldest clip(s) to stay under {OUTBOX_MAX_MB} MB")
    return clips


def send_heartbeat(pending_count):
    try:
        requests.post(
            DESKTOP_SERVER_URL + "/api/heartbeat",
            json={
                "pending_clips": pending_count,
                "seconds_since_audio": round(time.time() - last_audio_time, 1) if last_audio_time else None,
            },
            timeout=10,
            headers={"x-api-key": API_KEY}
        )
    except Exception as e:
        print(f"[HEARTBEAT ERROR] {e}")


def uploader_loop():
    backoff = 5
    last_heartbeat = 0.0

    # Clean up any .part files left behind if we were killed mid-write.
    for part in RECORDING_DIR.glob("*.part"):
        try:
            part.unlink()
        except OSError:
            pass

    while True:
        try:
            clips = enforce_outbox_limit(pending_clips())

            if time.time() - last_heartbeat >= HEARTBEAT_SECONDS:
                send_heartbeat(len(clips))
                last_heartbeat = time.time()

            if not clips:
                time.sleep(1)
                continue

            clip = clips[0]
            result = upload_audio(clip)

            if result in (UPLOADED, REJECTED):
                try:
                    clip.unlink()
                except OSError as e:
                    print(f"[CLEANUP ERROR] {e}")
                backoff = 5
                if len(clips) > 1:
                    print(f"[OUTBOX] {len(clips) - 1} clip(s) still pending")
            else:
                print(f"[OUTBOX] {len(clips)} clip(s) pending, retrying in {backoff}s")
                time.sleep(backoff)
                backoff = min(backoff * 2, 300)

        except Exception as e:
            # Never let the uploader thread die - recording depends on it
            # eventually draining the outbox.
            print(f"[UPLOADER ERROR] {e}")
            time.sleep(10)


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
    global is_recording, recording_buffer, silence_counter, last_audio_time

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
            # If the USB mic drops off the bus, the callback silently stops
            # firing and get() would block forever. Exit instead so systemd
            # (Restart=always) relaunches us with a fresh PortAudio device list.
            try:
                data = audio_queue.get(timeout=AUDIO_STALL_SECONDS)
            except queue.Empty:
                print(f"[AUDIO STALL] no audio for {AUDIO_STALL_SECONDS}s, exiting for systemd restart", flush=True)
                os._exit(1)

            last_audio_time = time.time()

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

                    save_clip(audio)

                    recording_buffer = []
                    silence_counter = 0.0

                # max duration safety
                elif duration >= MAX_RECORDING_SECONDS:
                    is_recording = False

                    save_clip(np.concatenate(recording_buffer))

                    recording_buffer = []
                    silence_counter = 0.0


# ----------------------------
# Entry point
# ----------------------------

def main():
    threading.Thread(target=uploader_loop, name="uploader", daemon=True).start()

    while True:
        try:
            monitor()
        except KeyboardInterrupt:
            print("\nStopped.")
            sys.exit(0)
        except Exception as e:
            print("Fatal error:", e)
            print("Restarting in 5s...")
            time.sleep(5)


if __name__ == "__main__":
    main()
