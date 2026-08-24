"""Local dev launcher: ensures cwd is server/ (matches production's `cd server && uvicorn ...`) before anything else imports config.py's relative paths. Not part of the deployed app."""
import os
os.chdir(os.path.dirname(os.path.abspath(__file__)))

import uvicorn
from main import app
from config import HOST, PORT

if __name__ == "__main__":
    uvicorn.run(app, host=HOST, port=PORT)
