FROM python:3.12-slim

# Same system audio libs as the old droplet (librosa/audioread fallbacks).
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

# Dedicated UID, deliberately not 1000 (the homelab's `ty`), so this
# internet-facing container never owns any other app's files.
RUN groupadd -g 10001 birdwatch && useradd -u 10001 -g 10001 -M -s /usr/sbin/nologin birdwatch

WORKDIR /app
COPY server/requirements.txt server/requirements.lock.txt server/
# requirements.lock.txt is the droplet's `pip freeze` at migration time, so
# BirdNET/TensorFlow behave exactly as they did there.
RUN pip install --no-cache-dir -r server/requirements.txt -c server/requirements.lock.txt

COPY server/ server/
COPY web/ web/

# Root filesystem is read-only at runtime; anything that wants a writable
# home or cache dir gets the /tmp tmpfs.
ENV PYTHONUNBUFFERED=1 HOME=/tmp NUMBA_CACHE_DIR=/tmp/numba MPLCONFIGDIR=/tmp TF_CPP_MIN_LOG_LEVEL=2

USER 10001:10001
# config.py's relative paths assume cwd is server/ (see CLAUDE.md "Local dev");
# compose overrides DATABASE_PATH/UPLOAD_DIR to the /data volume anyway.
WORKDIR /app/server
EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
