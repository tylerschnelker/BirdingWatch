"""
Continuous audio monitoring and recording for bird detection.
Runs on Raspberry Pi with USB microphone, records bird calls, and uploads to desktop server.
"""

import sounddevice as sd
import numpy as np
import requests
import wave
import os
import time
from datetime import datetime
from pathlib import Path
import sys

# Import configuration
from config import (
    DESKTOP_SERVER_URL,
    SAMPLE_RATE,
    CHANNELS,
    SILENCE_THRESHOLD,
    MIN_RECORDING_SECONDS,
    MAX_RECORDING_SECONDS,
    UPLOAD_ENDPOINT
)

# Local temporary directory for storing recordings before upload
RECORDING_DIR = Path("/tmp/birdwatch")
RECORDING_DIR.mkdir(parents=True, exist_ok=True)


def calculate_rms(audio_chunk):
    """
    Calculate the Root Mean Square (RMS) of an audio chunk.
    RMS is a measure of audio amplitude/loudness.
    """
    return np.sqrt(np.mean(audio_chunk.astype(np.float32) ** 2))


def save_wav(filename, audio_data, sample_rate):
    """
    Save audio data as a WAV file.
    """
    # Convert to 16-bit PCM for WAV format
    audio_int16 = (audio_data * 32767).astype(np.int16)
    
    with wave.open(str(filename), 'wb') as wav_file:
        wav_file.setnchannels(CHANNELS)
        wav_file.setsampwidth(2)  # 2 bytes for 16-bit
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(audio_int16.tobytes())


def upload_audio(filepath):
    """
    Upload the audio file to the desktop server via POST request.
    Returns True if successful, False otherwise.
    """
    upload_url = DESKTOP_SERVER_URL + UPLOAD_ENDPOINT
    
    try:
        with open(filepath, 'rb') as f:
            files = {'file': (os.path.basename(filepath), f, 'audio/wav')}
            response = requests.post(upload_url, files=files, timeout=30)
        
        if response.status_code == 200:
            print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Upload successful: {filepath.name}")
            return True
        else:
            print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Upload failed: HTTP {response.status_code}")
            return False
    except Exception as e:
        print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Upload error: {e}")
        return False


def monitor_and_record():
    """
    Main audio monitoring loop.
    Continuously listens for bird calls and uploads them to the server.
    """
    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Starting audio monitoring...")
    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Server URL: {DESKTOP_SERVER_URL}")
    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Silence threshold: {SILENCE_THRESHOLD}")
    
    # Audio chunk size for monitoring (0.1 seconds)
    chunk_size = int(SAMPLE_RATE * 0.1)
    
    # Rolling buffer for recording
    recording_buffer = []
    is_recording = False
    silence_counter = 0
    SILENCE_SECONDS_TO_END = 2  # End recording after 2 seconds of silence
    
    try:
        while True:
            # Read a chunk of audio
            audio_chunk = sd.rec(
                chunk_size,
                samplerate=SAMPLE_RATE,
                channels=CHANNELS,
                dtype=np.float32,
                blocking=True,
                device=0
            )
            sd.wait()
            
            # Calculate RMS (loudness)
            rms = calculate_rms(audio_chunk)
            
            # Check if we should start recording
            if not is_recording and rms > SILENCE_THRESHOLD:
                is_recording = True
                recording_buffer = [audio_chunk]
                silence_counter = 0
                print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Bird call detected, started recording (RMS: {rms:.4f})")
            
            # If recording, continue
            elif is_recording:
                recording_buffer.append(audio_chunk)
                
                # Check for silence to end recording
                if rms < SILENCE_THRESHOLD:
                    silence_counter += 0.1  # Each chunk is 0.1 seconds
                else:
                    silence_counter = 0
                
                # End recording conditions
                current_duration = len(recording_buffer) * 0.1
                if silence_counter >= SILENCE_SECONDS_TO_END and current_duration >= MIN_RECORDING_SECONDS:
                    # End recording
                    is_recording = False
                    
                    # Concatenate all chunks
                    full_audio = np.concatenate(recording_buffer)
                    
                    # Enforce max duration
                    max_samples = int(MAX_RECORDING_SECONDS * SAMPLE_RATE)
                    if len(full_audio) > max_samples:
                        full_audio = full_audio[:max_samples]
                    
                    # Save to file
                    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                    filename = f"birdcall_{timestamp}.wav"
                    filepath = RECORDING_DIR / filename
                    
                    save_wav(filepath, full_audio, SAMPLE_RATE)
                    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Saved clip: {filename} ({len(full_audio)/SAMPLE_RATE:.1f}s)")
                    
                    # Upload to server
                    if upload_audio(filepath):
                        # Delete local file after successful upload
                        os.remove(filepath)
                        print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Deleted local file: {filename}")
                    else:
                        print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Keeping local file due to upload failure")
                    
                    # Reset buffer
                    recording_buffer = []
                    silence_counter = 0
                
                # Also enforce max duration during recording
                elif current_duration >= MAX_RECORDING_SECONDS:
                    is_recording = False
                    full_audio = np.concatenate(recording_buffer)
                    
                    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                    filename = f"birdcall_{timestamp}.wav"
                    filepath = RECORDING_DIR / filename
                    
                    save_wav(filepath, full_audio, SAMPLE_RATE)
                    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Saved clip (max duration): {filename}")
                    
                    if upload_audio(filepath):
                        os.remove(filepath)
                        print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Deleted local file: {filename}")
                    else:
                        print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Keeping local file due to upload failure")
                    
                    recording_buffer = []
                    silence_counter = 0
                
                # Discard if too short (silence ended too quickly)
                elif silence_counter >= SILENCE_SECONDS_TO_END and current_duration < MIN_RECORDING_SECONDS:
                    is_recording = False
                    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Discarded short clip ({current_duration:.1f}s < {MIN_RECORDING_SECONDS}s)")
                    recording_buffer = []
                    silence_counter = 0
    
    except KeyboardInterrupt:
        raise
    except Exception as e:
        print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Error in monitoring loop: {e}")
        raise


def main():
    while True:
        try:
            monitor_and_record()
        except KeyboardInterrupt:
            print("\nStopping BirdWatch. Goodbye!")
            sys.exit(0)
        except Exception as e:
            print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Fatal error: {e}")
            print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Restarting in 5 seconds...")
            time.sleep(5)


if __name__ == "__main__":
    main()
