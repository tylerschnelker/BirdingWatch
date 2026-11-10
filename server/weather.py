"""
Hourly weather for the birdbath scene, from Open-Meteo (free, no key).

Only a coarse location leaves the server: LAT/LON rounded to 0.1 degree
(~10 km), plenty for clouds, rain and snow. The browser never sees it; the
API returns conditions only. Past days are cached for the process's life,
today for 15 minutes. Failures return [] so the scene just shows clear sky.
"""
import threading
import time
from datetime import date, datetime, timedelta
from typing import Dict, List, Tuple

import requests

from config import LAT, LON

FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
TODAY_TTL_SECONDS = 15 * 60
# The forecast API serves roughly the last three months; older days come
# from the archive (which lags a few days, so recent days use the forecast).
FORECAST_MAX_AGE_DAYS = 80

_cache: Dict[str, Tuple[float, List[Dict]]] = {}
_lock = threading.Lock()


def _coarse(value) -> float:
    return round(float(value), 1)


def _fetch(day: str) -> List[Dict]:
    age = (date.today() - datetime.strptime(day, '%Y-%m-%d').date()).days
    params = {
        "latitude": _coarse(LAT),
        "longitude": _coarse(LON),
        "hourly": "weather_code,cloud_cover,temperature_2m,precipitation,snowfall",
        "temperature_unit": "fahrenheit",
        "timezone": "America/Denver",
        "start_date": day,
        "end_date": day,
    }
    url = ARCHIVE_URL if age > FORECAST_MAX_AGE_DAYS else FORECAST_URL
    response = requests.get(url, params=params, timeout=10)
    response.raise_for_status()
    hourly = response.json()["hourly"]
    return [
        {
            "code": hourly["weather_code"][i],
            "cloud": hourly["cloud_cover"][i],
            "temp": None if hourly["temperature_2m"][i] is None else round(hourly["temperature_2m"][i]),
            "precip": hourly["precipitation"][i],
            "snow": hourly["snowfall"][i],
        }
        for i in range(len(hourly["time"]))
    ]


def get_day_weather(day: str) -> List[Dict]:
    """24 hourly entries (code, cloud %, temp °F, precip mm, snow cm) for a local day, or []."""
    if LAT in (None, "", "none") or LON in (None, "", "none"):
        return []
    today = date.today().isoformat()
    if day > today or day < (date.today() - timedelta(days=3650)).isoformat():
        return []

    with _lock:
        cached = _cache.get(day)
    if cached and (day != today or time.time() - cached[0] < TODAY_TTL_SECONDS):
        return cached[1]

    try:
        hours = _fetch(day)
    except Exception as e:
        print(f"Weather fetch failed for {day}: {e}")
        return cached[1] if cached else []

    # Fetched today for a past day can still be partial (archive lag); cache
    # only complete days for good.
    if day == today or all(h["code"] is not None for h in hours):
        with _lock:
            _cache[day] = (time.time(), hours)
    return hours
