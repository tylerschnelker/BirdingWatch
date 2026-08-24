# BirdWatch

Backyard bird-call detector. A Raspberry Pi records audio continuously, uploads
clips over HTTPS to a cloud server, the server runs BirdNET-Analyzer to identify
species, stores results in SQLite, and serves a small vanilla-JS dashboard.

Live site: https://marysbackyardbirds.xyz/ (DigitalOcean droplet, single Ubuntu
server running both the API and the web UI via one FastAPI process + systemd).

## Architecture

```
Raspberry Pi (pi/recorder.py)
  -> USB mic -> RMS-based voice-activity trigger -> saves .wav locally
  -> POSTs to {DESKTOP_SERVER_URL}/upload-audio with x-api-key header
  -> deletes local file after upload (success or failure, always cleaned up)

Cloud server (server/main.py, FastAPI)
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
  summary/image per species (cached in-memory dict, not persisted)
- [server/database.py](server/database.py) — raw `sqlite3`, no ORM. See "Sessions" below.
- [server/config.py](server/config.py) — server env vars (loads `server/.env` if present, else falls
  back to defaults; the real deployed config is in the repo-root `.env`, gitignored)
- [pi/recorder.py](pi/recorder.py) — continuous `sounddevice` stream, RMS-threshold VAD, saves/uploads/retries/cleans up
- [pi/config.py](pi/config.py) — Pi env vars
- [.github/workflows/deploy.yml](.github/workflows/deploy.yml) — on push to `main`: a self-hosted
  runner *on the Pi itself* pulls + restarts `birdwatch-recorder`; a separate job SSHes into the
  DigitalOcean droplet, pulls, restarts the `birdwatch` systemd service. No staging, no tests, no
  build step — push to main deploys straight to production on both machines.

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

## Config / environment

- Root-level `.env` (gitignored) holds the real deployed values for both the Pi and the server —
  `.env.example` documents all keys. `LAT`/`LON` are set to real Colorado coordinates.
- `server/config.py` loads `server/.env` specifically (`BASE_DIR / ".env"`), not the root one — worth
  double-checking which `.env` is actually present/used on each machine if config seems stale.
- API auth is a single shared static `API_KEY` sent as `x-api-key` header — no per-device keys, no
  rotation mechanism.

## Gotchas / things not obvious from reading one file

- `server/analyzer.py`'s `Analyzer()` (the BirdNET model) is instantiated fresh inside every call to
  `analyze_audio()`, i.e. reloaded from disk on every single upload rather than once at startup.
  Not an accuracy issue, but worth knowing if latency/CPU on the droplet ever comes up.
- `database.py.init_db()` does ad-hoc `ALTER TABLE ... ADD COLUMN` migrations wrapped in
  try/except — there's no migration framework. If you change the schema, follow that pattern or
  expect the comment's advice ("delete birdwatch.db") to nuke history.
- Wikipedia species info (`fetch_bird_info`) is looked up by common name with no disambiguation,
  cached only in an in-memory dict that resets on server restart — wrong/missing images or bios for
  ambiguous species names are a UI/content issue, not a detection-accuracy one.
- `pi/config.py` defaults `SAMPLE_RATE` to 48000 but the actual deployed root `.env` sets 44100 —
  birdnetlib/librosa resample internally so this isn't currently causing problems, but the mismatch
  between file default and actual value is worth knowing if audio issues come up.
