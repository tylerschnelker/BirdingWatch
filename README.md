# BirdWatch

A full-stack bird identification application that automatically detects and identifies bird species from audio recordings in your backyard.

## Overview

BirdWatch uses a Raspberry Pi with a USB microphone to continuously monitor for bird calls. When a bird is detected, the audio clip is sent to a desktop server running BirdNET-Analyzer (Cornell Lab's bird identification library) for species identification. Results are stored in SQLite and served through a beautiful, mobile-friendly web UI that you can access from anywhere.

## Architecture

```
┌─────────────────┐         WiFi          ┌─────────────────┐
│  Raspberry Pi   │ ◄────────────────────► │  Desktop Server │
│  + USB Mic      │                         │  (FastAPI)      │
│  - recorder.py  │                         │  - BirdNET     │
│  - config.py    │                         │  - SQLite DB   │
└─────────────────┘                         └─────────────────┘
                                                    │
                                                    │
                                                    ▼
                                            ┌─────────────────┐
                                            │  Web UI         │
                                            │  (HTML/CSS/JS)  │
                                            │  - Mobile view  │
                                            └─────────────────┘
```

## Tech Stack

- **Pi**: Python 3, sounddevice, requests, numpy
- **Desktop Server**: Python 3, FastAPI, BirdNET-Analyzer, SQLite, uvicorn, aiofiles
- **Frontend**: Vanilla HTML/CSS/JS (no frameworks, no build step)
- **Database**: SQLite (single file)

## Project Structure

```
birdwatch/
├── pi/
│   ├── recorder.py      # Audio monitoring and upload loop
│   ├── config.py        # Pi configuration
│   └── requirements.txt # Pi dependencies
├── server/
│   ├── main.py          # FastAPI application
│   ├── analyzer.py      # BirdNET integration
│   ├── database.py      # SQLite operations
│   ├── models.py        # Data models
│   ├── config.py        # Server configuration
│   ├── uploads/         # Audio file storage
│   ├── static/          # Static files
│   └── requirements.txt # Server dependencies
├── web/
│   ├── index.html       # Main web UI
│   ├── style.css        # Styling
│   └── app.js           # Frontend logic
├── .env.example         # Example environment variables
├── .gitignore
└── README.md
```

## Setup Instructions

### 1. Configure Environment Variables

Copy the example environment file and fill in your values:

```bash
cp .env.example .env
```

Edit `.env` and set:
- `DESKTOP_SERVER_URL`: Your desktop's local IP (e.g., `http://192.168.1.100:8000`)
- `LAT` and `LON`: Your coordinates for better BirdNET accuracy (optional)

### Desktop Server Setup

1. **Install Python dependencies:**
   ```bash
   cd server
   pip install -r requirements.txt
   ```

2. **Run the server:**
   ```bash
   cd server
   uvicorn main:app --reload --host 0.0.0.0 --port 8000
   ```

   The server will start on `http://localhost:8000` and the web UI will be available at `http://localhost:8000`

### Raspberry Pi Setup

1. **Install Python dependencies:**
   ```bash
   cd pi
   pip install -r requirements.txt
   ```

2. **Copy the .env file** from your desktop to the Pi, or create it manually with the same values.

3. **Connect USB microphone:**
   Ensure your USB microphone is connected and recognized by the Pi.

4. **Run the recorder:**
   ```bash
   cd pi
   python recorder.py
   ```

   The recorder will start monitoring audio and automatically upload bird calls to the server.

## Remote Access with Tailscale

To access the BirdWatch web UI from outside your home network (e.g., on your phone while away):

1. **Install Tailscale** on both your desktop and your phone
   - Download from [tailscale.com](https://tailscale.com)
   - Sign in with the same account on both devices

2. **Connect both devices** to your Tailscale network

3. **Access the web UI** using your desktop's Tailscale IP:
   - Find your desktop's Tailscale IP in the Tailscale admin panel
   - Open `http://<TAILSCALE_IP>:8000` on your phone

## Usage

- The web UI auto-refreshes every 30 seconds
- View recent detections with audio playback
- Browse species summary with visit counts
- Click "Read more" to expand Wikipedia summaries
- Missing bird photos show a silhouette placeholder

## Troubleshooting

- **No detections**: Check that the Pi can reach the server (ping test)
- **Upload failures**: Verify the DESKTOP_SERVER_URL in .env is correct
- **BirdNET errors**: Ensure birdnetlib is installed on the server
- **Audio issues**: Check microphone permissions and device selection
- **Config not loading**: Ensure .env file exists in the project root

## License

This project uses BirdNET-Analyzer from the Cornell Lab of Ornithology.
