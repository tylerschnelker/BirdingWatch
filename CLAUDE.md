# BirdWatch

Backyard bird-call detector. A Raspberry Pi records audio continuously, uploads
clips over HTTPS to the server, the server runs BirdNET-Analyzer to identify
species, stores results in SQLite, and serves a small vanilla-JS dashboard.

Live site: https://marysbackyardbirds.xyz/ (since 2026-10-03: a Docker container on
the user's home server ("homelab"), published only through a Cloudflare Tunnel; see
"Hosting" below. Previously a DigitalOcean droplet, decommissioned.)

## Hosting (homelab + Cloudflare Tunnel)

- **Container**: `Dockerfile` + `docker-compose.yml` at the repo root. Python 3.12 with
  `server/requirements.lock.txt` as pip constraints. That file is the droplet's
  `pip freeze` at migration (TensorFlow 2.21.0, birdnetlib 0.18.1), so BirdNET
  behaves exactly as it did there; update it deliberately. Runs `uvicorn main:app`
  from `server/`.
- **Data volume**: `./data` (gitignored) is mounted at `/data`. It holds
  `birdwatch.db` and `uploads/` via `DATABASE_PATH`/`UPLOAD_DIR` overrides in
  compose, owned by the container's dedicated UID 10001 (dir 700, files 600).
  `TZ=America/Denver` must keep matching the Pi (see "Recorded time" below).
- **Config**: `./.env` (gitignored, 600) is the droplet's `server/.env` copied
  byte-for-byte, loaded via compose `env_file`. **Never regenerate the VAPID keys**:
  every push subscription would break.
- **Isolation (the same homelab runs a private, auth-less finance app)**: no host
  ports published at all. The container is non-root, has a read-only root fs
  (`/tmp` tmpfs), drops all capabilities, sets no-new-privileges, has CPU/mem/pids
  limits, has no Docker socket, and mounts only `./data`. Its `birdingwatch` Docker
  network (bridge `br-birdwatch`, 172.30.50.0/24) is firewalled by
  `scripts/birdingwatch-firewall.sh`, installed root-owned at `/usr/local/sbin/` and
  run by `birdingwatch-firewall.service` before docker.service. It drops all
  traffic from that bridge to the host itself and to private/CGNAT/link-local
  ranges (LAN, Tailscale peers, other Docker networks), and allows the internet
  (Cloudflare, Wikipedia, web push). Verified at migration from inside the
  container: finance app, Backrest, SSH, router, PC and Pi all blocked; internet
  reachable. Changes to `docker-compose.yml` or the firewall script weaken or
  strengthen this boundary, so review them as security changes.
- **Public access**: a *locally-managed* Cloudflare Tunnel named `homelab`, created
  with the `cloudflared` CLI (not the Zero Trust dashboard). The `cloudflared`
  container shares only the `birdingwatch` network and runs as nonroot UID 65532,
  read-only. It gets only `./cloudflared/config.yml` and the tunnel credentials
  JSON (gitignored, 600/400), not the account cert. Ingress:
  `marysbackyardbirds.xyz` and `www` → `http://birdingwatch:8000`, everything
  else → 404. DNS is on Cloudflare (moved from Porkbun); TLS terminates at
  Cloudflare. The droplet's nginx and its `client_max_body_size` are gone.
  Cloudflare's 100 MB upload limit is far above any clip. Cloudflare edge-caches `.js`/`.css`
  for hours when the origin sends no Cache-Control, which hid a deploy's frontend changes;
  `main.py`'s `no_cache_static` middleware now sends `no-cache` on `/static/`, and `index.html`'s
  `?v=` query on app.js/style.css was bumped once (2026-10-07) to escape the stale edge copies.
- **Deploys**: by hand, `scripts/deploy-homelab.sh` (pull `--ff-only`, rebuild,
  restart, wait for the healthcheck, check the public URL). It warns when
  isolation files changed. GitHub can't reach the homelab and there's no runner
  on it; see the deploy.yml note under "Key files".

## Architecture

```
Raspberry Pi (pi/recorder.py)
  -> USB mic -> RMS-based voice-activity trigger -> saves .wav locally
  -> POSTs to {DESKTOP_SERVER_URL}/upload-audio with x-api-key header
  -> clips queue in a local outbox; a background thread uploads oldest-first and deletes
     only once the server accepts (survives network outages - see "Recorder reliability")
  -> POSTs /api/heartbeat every 60s so the server can alert when the recorder goes dark

Server (server/main.py, FastAPI; homelab Docker container behind a Cloudflare Tunnel)
  -> /upload-audio: saves .wav, runs analyzer.analyze_audio() (BirdNET),
     groups detections by species, upserts into SQLite as "sessions", and
     runs the daily-best-clip retention claim (see "Audio retention" below)
  -> /api/today, /api/days/{date}, /api/days/{date}/species/{species} — the
     day-grouped feed the frontend actually uses now
  -> /api/detections, /api/species, /api/audio/{filename}, /api/detections/{id} (GET+DELETE)
     — /api/detections (flat list) is unused by the frontend now but left in place
  -> serves web/ as static files and at "/"

Web UI (web/index.html, app.js, style.css)
  -> vanilla JS, no build step, no framework, hits the /api/* endpoints above
  -> "Recent Detections" tab = day-grouped, species-grouped view (see below),
     not a flat session feed
```

## Local dev

`server/_run_local.py` + `.claude/launch.json` let you preview the web UI locally
(`cd server && python _run_local.py`, or via the Browser tool's `preview_start` with
name `birdwatch-local`). It exists solely to force the process's cwd to `server/`
before anything imports `config.py`'s relative paths (`DATABASE_PATH`, `UPLOAD_DIR`) —
production always runs `cd server && uvicorn main:app ...`, but a naive
`uvicorn --app-dir server` from the repo root only fixes imports, not cwd, and will
silently create a second, empty `birdwatch.db`/`uploads/` at the repo root instead of
using `server/`'s. Both files are local dev tooling, not part of the deployed app.

## Key files

- [server/main.py](server/main.py) — FastAPI app, all routes, upload handling, session grouping logic
- [server/analyzer.py](server/analyzer.py) — wraps `birdnetlib` for species ID; also fetches Wikipedia
  summary/image per species (cached in-memory dict, not persisted). Stored on each new session as the
  fallback; what the feed actually shows comes from `species_media.py` (below).
- [server/species_media.py](server/species_media.py) — rotating daily photo + description per species.
  See "Rotating photos and descriptions" below.
- [server/database.py](server/database.py) — raw `sqlite3`, no ORM. See "Sessions" below.
- [server/config.py](server/config.py) — server env vars (loads `server/.env` if present, else falls
  back to defaults; the real deployed config is in the repo-root `.env`, gitignored)
- [pi/recorder.py](pi/recorder.py) — continuous `sounddevice` stream, RMS-threshold VAD, saves/uploads/retries/cleans up
- [pi/config.py](pi/config.py) — Pi env vars
- [.github/workflows/deploy.yml](.github/workflows/deploy.yml) — on push to `main`: a self-hosted
  runner *on the Pi itself* pulls + restarts `birdwatch-recorder`. That's the only job now. The
  old job that SSHed into the droplet was removed at the migration, deliberately not replaced:
  the homelab deploys by hand with `scripts/deploy-homelab.sh`. Opening the homelab's SSH to
  GitHub or running a self-hosted runner on it (risky for a public repo) were both rejected.
  The repo is public and the Pi runs a self-hosted runner, so fork-PR workflows should require
  approval for all external contributors (Settings → Actions → General).
- [Dockerfile](Dockerfile), [docker-compose.yml](docker-compose.yml),
  [scripts/](scripts/) — homelab deployment, firewall isolation, deploy script; see "Hosting".

## "Sessions" concept (important, non-obvious)

Detections aren't stored one-row-per-chirp. `server/main.py` groups all detections in one uploaded
clip by species, then in `database.py`, `find_active_session()` checks if that species already has
a row whose `last_detected_timestamp` is within `SESSION_TIMEOUT_MINUTES` (default 10). If yes, it
increments `detection_count`/updates `last_detected_at` on the existing row instead of inserting a
new one. So one DB row = one continuous "visit" by a species, not one call. This is why the
dashboard shows counts/durations per visit rather than a raw detection log.

## Accuracy fixes applied (2026-08-24)

User reported concrete false positives: a squeaky door, a passing ambulance, and a dog bark were all
getting logged as bird species. Root-caused and fixed three things in `server/analyzer.py` and
`server/main.py`:

1. **Location/season filter was silently disabled.** `analyze_audio()` passed `lat`/`lon` into
   birdnetlib's `Recording` but never passed `date`. Per the installed `birdnetlib` source
   (`.venv/Lib/site-packages/birdnetlib/main.py`), the eBird species-occurrence filter only activates
   when `week_48` is derived from a `date` — otherwise it defaults to `-1` (filter disabled), and
   `Recording.detections` falls back to returning everything (`len(allow_list) == 0`). Fixed by
   passing `date=datetime.now()`. As a side effect, this also excludes BirdNET's non-bird "event"
   labels (see below) automatically, since they're not real eBird species and won't appear in the
   location-derived allow list.
2. **BirdNET's non-bird event classes weren't filtered.** BirdNET's label set
   (`BirdNET_GLOBAL_6K_V2.4_Labels.txt`) includes classes like `Dog_Dog`, `Siren_Siren`,
   `Engine_Engine`, `Human vocal_Human vocal`, `Noise_Noise`, etc. — used to recognize common
   background noise, not species. Nothing filtered these out, so if BirdNET *correctly* labeled a bark
   as "Dog", the code stored it as a bird sighting anyway. Added `NON_BIRD_LABELS` in `analyzer.py`
   to explicitly drop these regardless of confidence, as a safety net independent of fix #1 above.
3. **Single-occurrence detections were exactly as trusted as repeated ones.** Empirical observation:
   species detected 2+ times in a session are usually real; one-off detections (a single door squeak,
   siren, bark) are the common false-positive case — but a real bird that only calls once shouldn't be
   silently dropped either. Added `SINGLETON_CONFIDENCE_THRESHOLD` (default 0.85, vs. the base
   `BIRDNET_CONFIDENCE_THRESHOLD` 0.7) in `server/config.py`. In `main.py`'s per-species loop: if a
   species has no existing active session AND was only detected once in this clip, it must clear the
   higher bar to be logged at all; repeats within the same clip, or anything extending an
   already-confirmed session, only need the normal 0.7. Tradeoff (accepted): a genuine single call
   between 0.7–0.85 confidence on its very first sighting will be held back rather than logged.

Secondary, not yet addressed: `pi/recorder.py` triggers recording purely on RMS amplitude
(`SILENCE_THRESHOLD`, default 0.01) with no frequency/bandpass gating, so wind/traffic/noise above
that threshold still get recorded and sent to the server as a clip in the first place (the fixes
above stop them from being *logged as a species*, but the Pi still uploads and the server still runs
inference on pure noise clips — wasted work, not an accuracy problem now).

## Day-grouped feed, audio retention, Wikipedia fallback (2026-08-24)

Follow-up round after the accuracy fixes above. User's complaints: (1) common species (Blue
Jay, Bushtit) flooded the flat "Recent Detections" feed since every ~10min gap starts a new
session row; (2) the feed had a hard `limit=50` with no pagination/date filter, so busy days
pushed older detections out of reach entirely; (3) a session's audio playback sometimes didn't
match its "best confidence" badge; (4) every uploaded clip was kept forever (real problem given
the droplet's limited disk); (5) Wikipedia summary/photo sometimes blank.

**Data model**: `detections` (sessions/visits) is unchanged in shape. New table
`daily_best_clips` (species_common, detection_date 'YYYY-MM-DD', audio_filename, confidence,
session_id, updated_at, UNIQUE(species_common, detection_date)) tracks the single retained clip
per species per day — see `database.py`'s `get_daily_best`/`insert_daily_best`/
`update_daily_best`/`count_daily_best_references`/`get_daily_best_by_filename`/`delete_daily_best`.

**Retention policy**: only the highest-confidence clip per species per day is kept, ever. In
`main.py`'s `/upload-audio` handler, after the existing session insert/update, each species
either claims the uploaded file (beats or establishes that day's best — old file deleted if no
longer referenced) or doesn't (file deleted at the end of the request if unclaimed by every
species in it). `count_daily_best_references` guards against deleting a file that's still the
retained best for a *different* species (one clip can capture two species at once).
`DELETE /api/detections/{id}` now reconciles `daily_best_clips` and deletes the file too (this
endpoint never touched audio at all before — a pre-existing leak, fixed incidentally). A session
row's `audio_filename` is informational only now — the file it names may have been deleted by a
better clip for the same species/day; readers must check `audio_available` (from
`get_day_species_visits`), not assume the file still exists. `update_session_with_count` was also
changed so `audio_filename` only updates when the new confidence beats the stored one (previously
unconditional — this was the "wrong call" playback bug).

**One-time backfill**: `server/backfill_daily_best.py` (flat script, run from `server/`,
`--dry-run` first) retroactively applies this policy to whatever's already on disk/in the DB —
this is how disk space actually gets reclaimed on the already-deployed droplet, since everything
uploaded before this change was kept forever. Idempotent, safe to re-run.

**Frontend**: "Recent Detections" now fetches `/api/days/{date}` (species-grouped, sorted rarer
species first via an `all_time_sessions` tiebreak, then recency) instead of the old flat feed.
Prev/next-day nav (`shiftDateString`/`loadDayView` in `app.js`) is anchored to `/api/today` (the
*server's* local date), not the browser's, so viewing from another timezone doesn't shift "today".
Expanding a card lazy-fetches `/api/days/{date}/species/{species}` for the individual visits.
Species names can contain apostrophes (Cooper's Hawk, etc.) — never interpolate them into
`onclick="..."`/`id="..."` strings; the day-card wiring uses `addEventListener` + direct element
refs instead (see `renderSpeciesDayCard` in `app.js`) specifically because of this.

**Wikipedia**: `fetch_bird_info(species_common, species_scientific=None)` now tries common name →
scientific name → Wikipedia opensearch-resolved title, caching whichever result is non-empty (or
the last miss — negative caching added since a miss can now cost up to 3 requests). Also fixed:
the REST summary URL wasn't URL-encoding the title before, which likely broke lookups for
parenthetical/subspecies-qualified names.

**Known limitations carried forward**: the daily-best read-then-write isn't transactional
(matches the pre-existing `find_active_session` race, acceptable at single-Pi scale); a session
that straddles midnight is bucketed by `last_detected_timestamp` (the day it *ended*), not started.

## Recorder reliability: outbox, heartbeat, offline alerts (2026-09-29)

The Pi went dark twice (Sep 25, Sep 29) with no alert. Persistent journal logs showed two
independent causes, neither a full freeze: (1) the USB mic briefly disconnected (`usb 1-2: USB
disconnect`), after which the old recorder's blocking `audio_queue.get()` waited forever while
systemd still reported it "active"; (2) weak Wi-Fi (~51-55%) with the Pi flapping between two mesh
APs ~170 times in 8h until DNS/connectivity died, so it was unreachable by SSH/mDNS. Also found:
nginx's default 1 MB `client_max_body_size` had been 413-rejecting every clip over ~12s (~13k
rejected requests in the logs) - the longest, often best, recordings.

- **Recorder** (`pi/recorder.py`): recording and uploading are decoupled. The audio loop only saves
  clips (atomic `.part` → rename) into `/home/pi/birdwatch_recordings` (the outbox); a daemon
  uploader thread sends them oldest-first and deletes only on 200 (or a permanent 400/413/415/422).
  Network errors keep the file and back off up to 5 min. `OUTBOX_MAX_MB` (default 2000) caps the
  outbox, dropping oldest. `get(timeout=10)` + `os._exit(1)` turns a mic stall into a systemd
  restart (`Restart=always`) with a fresh PortAudio device list. stdout is line-buffered so prints
  reach `journalctl -u birdwatch-recorder`.
- **Recorded time vs arrival time**: backfilled clips arrive late, so `main.py`'s
  `recorded_time_for()` dates detections from the `birdcall_YYYYMMDD_HHMMSS` filename (Pi and
  server share a timezone; falls back to now if missing, >7 days old, or in the future).
  `find_active_session`/`insert_session`/`update_session_with_count` take that timestamp;
  `last_detected_timestamp` only moves forward.
- **Heartbeat / status / alerts**: the Pi POSTs `/api/heartbeat` every `HEARTBEAT_SECONDS` (60)
  with `pending_clips` and `seconds_since_audio`. `recorder_state` in `main.py` is in-memory only.
  `watch_recorder_health()` pushes "Recorder offline" (distinguishing "no contact" from "online but
  mic silent") after `RECORDER_OFFLINE_MINUTES` (30) and "back online" on recovery, reusing the web
  push subscriptions (`notifications.send_push`). `/api/recorder-status` drives the header status
  indicator in the web UI (it used to be a hard-coded "Live" dot).
- **Pi system config (manual, not deployed by CI)**: `pi/system/birdwatch-netwatch.{sh,service,timer}`
  escalates on lost connectivity (bounce radio → restart NetworkManager → reboot if up >30 min).
  Also applied by hand on the Pi: persistent journald (`/etc/systemd/journald.conf.d/99-persistent.conf`
  overriding Raspberry Pi OS's `40-rpi-volatile-storage.conf`, capped at 200M), Wi-Fi power save off
  (`/etc/NetworkManager/conf.d/wifi-powersave-off.conf`), hardware watchdog
  (`/etc/systemd/system.conf.d/watchdog.conf`, `RuntimeWatchdogSec=15`). `pi` needs a sudo password,
  so none of this can be changed remotely without the user.
- **nginx** (formerly on the droplet, with `client_max_body_size 20M` for long clips) is gone
  since the homelab move. Cloudflare's tunnel fronts the app directly (100 MB request limit).
  The Pi's `DESKTOP_SERVER_URL` (in `pi/.env`) is `https://marysbackyardbirds.xyz`, the domain,
  not an IP, so the move needed no Pi change. Note that line in the Pi's file has a space
  before `=` (`DESKTOP_SERVER_URL =https://...`), which python-dotenv tolerates.

## Rotating photos and descriptions (2026-10-07)

User complaint: the same Wikipedia lead photo and intro paragraph every day for a species.
`species_media.py` caches, per species in the `species_media` table (refreshed every 30 days, empty
results retried after 1 day, by a background thread started at startup, ~3 s between species so
iNaturalist isn't hammered; page loads never wait on an API):
- **Photos**: up to 50 iNaturalist research-grade observation photos (most-faved first, one per
  observation, CC licenses only, `small` 240px size). Taxon matched by scientific name then common
  name, accepting `matched_term` synonyms (BirdNET's "Cordilleran Flycatcher" is iNat's Western
  Flycatcher). CC BY* licenses require credit, so cards show "📷 observer · iNaturalist (license)"
  linking to the observation. **Keep that credit if the card layout changes.**
- **Descriptions**: the Wikipedia article iNaturalist links to the taxon (avoids name ambiguity:
  "Bushtit" redirects to the whole family), then scientific, then common name. Plaintext extract split
  into sections; references/links and dry taxonomy/subspecies sections are skipped; each is trimmed to
  ~1200 chars. Shown with the section title and a "Wikipedia" link (CC BY-SA attribution).
- **Rotation**: `_pick()` = `(date.toordinal() + sha256(species) offset) % pool size`, so a species
  shows the same thing all day, past days stay stable, and nothing repeats until the pool cycles.
- `apply_daily_media()` runs in `/api/days/{date}` (that date) and `/api/species` (today), adding
  `photo_credit` and `fact`; with no cache it falls back to the session's stored Wikipedia photo/summary.
- The day feed also returns `first_heard_timestamp` and `days_heard` ("🏡 First heard here May 30 ·
  heard on 45 days", counting days up to the viewed day; hidden on a first-ever card).
- Text from these APIs goes through `escapeHtml()` in `app.js` (this site is public).

## Config / environment

- `.env.example` documents all keys. `LAT`/`LON` are set to real Colorado coordinates.
- **Server**: the real values are the homelab's repo-root `.env`, passed to the container by compose
  `env_file`. It's a byte-identical copy of what the droplet actually ran from, `server/.env`
  (the droplet had no root `.env`). Compose overrides `DATABASE_PATH`/`UPLOAD_DIR` to `/data`.
  `server/config.py`'s own `load_dotenv(BASE_DIR / ".env")` finds nothing in the image, which is
  fine: env vars are already set.
- **Pi**: `pi/.env` on the Pi (`pi/config.py` calls `load_dotenv()` from the `pi/` working dir);
  the Pi's repo-root `.env` is effectively empty.
- API auth is a single shared static `API_KEY` sent as `x-api-key` header — no per-device keys, no
  rotation mechanism.

## Gotchas / things not obvious from reading one file

- `server/analyzer.py`'s `Analyzer()` (the BirdNET model) is instantiated fresh inside every call to
  `analyze_audio()`, i.e. reloaded from disk on every single upload rather than once at startup.
  Not an accuracy issue, but worth knowing if latency/CPU on the server ever comes up (~15s for
  the first upload after a container start on the homelab, including model load).
- `database.py.init_db()` does ad-hoc `ALTER TABLE ... ADD COLUMN` migrations wrapped in
  try/except — there's no migration framework. If you change the schema, follow that pattern or
  expect the comment's advice ("delete birdwatch.db") to nuke history.
- Wikipedia species info (`fetch_bird_info`) is looked up by common name with no disambiguation,
  cached only in an in-memory dict that resets on server restart. It's only the fallback now; the
  displayed photo/description come from `species_media.py`.
- `pi/config.py` defaults `SAMPLE_RATE` to 48000 but the actual deployed root `.env` sets 44100 —
  birdnetlib/librosa resample internally so this isn't currently causing problems, but the mismatch
  between file default and actual value is worth knowing if audio issues come up.
