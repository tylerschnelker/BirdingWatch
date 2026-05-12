import sounddevice as sd
import numpy as np

DESKTOP_SERVER_URL = 'http://localhost:5000'
UPLOAD_ENDPOINT = '/upload'
SAMPLE_RATE = 44100
CHANNELS = 1
SILENCE_THRESHOLD = 0.5

def calculate_rms(audio_chunk):
    """
    Calculate the RMS (Root Mean Square) value of an audio chunk.
    """
    return np.sqrt(np.mean(np.square(audio_chunk)))

def save_wav(filename, audio_data, sample_rate):
    """
    Save audio data as a WAV file.
    """
    from scipy.io.wavfile import write
    write(filename, sample_rate, (audio_data * 32768).astype(np.int16))

def monitor_and_record():
    """
    Main audio monitoring loop.
    Continuously listens for bird calls and uploads them to the server.
    """
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
            audio_chunk, overflow = sd.rec(
                chunk_size,
                samplerate=SAMPLE_RATE,
                channels=CHANNELS,
                dtype=np.float32,
                blocking=True
            )
            
            # Calculate RMS (loudness)
            rms = calculate_rms(audio_chunk)
            if rms < SILENCE_THRESHOLD:
                silence_counter += 1
            else:
                silence_counter = 0
            
            if not is_recording and silence_counter > int(SILENCE_SECONDS_TO_END * SAMPLE_RATE / chunk_size):
                # Start recording
                is_recording = True
                recording_buffer.clear()
            
            if is_recording:
                recording_buffer.append(audio_chunk)
            
            if is_recording and silence_counter >= int(SILENCE_SECONDS_TO_END * SAMPLE_RATE / chunk_size):
                # End recording
                is_recording = False
                filename = f"recording_{int(time.time())}.wav"
                save_wav(filename, np.concatenate(recording_buffer), SAMPLE_RATE)
                upload_audio(filename)

def upload_audio(filepath):
    """
    Upload the audio file to the desktop server via POST request.
    """
    import requests
    import os
    from datetime import datetime
    
    upload_url = DESKTOP_SERVER_URL + UPLOAD_ENDPOINT
    
    with open(filepath, 'rb') as f:
        files = {'file': (os.path.basename(filepath), f, 'audio/wav')}
        response = requests.post(upload_url, files=files)
    
    if response.status_code == 200:
        print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Upload successful: {filepath}")
    else:
        print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Upload failed: HTTP {response.status_code}")

def main():
    """
    Main entry point with retry loop to prevent permanent crashes.
    """
    while True:
        try:
            monitor_and_record()
        except Exception as e:
            print(f"Fatal error: {e}")
            print("Restarting in 5 seconds...")
            time.sleep(5)

if __name__ == "__main__":
    main()
