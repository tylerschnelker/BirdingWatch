"""
Audio analysis using BirdNET-Analyzer for bird species identification.
Also fetches bird information from Wikipedia.
"""

import requests
import urllib.parse
from typing import List, Dict, Optional
from datetime import datetime

from config import BIRDNET_CONFIDENCE_THRESHOLD, LAT, LON

# In-memory cache for bird info to avoid hammering Wikipedia
bird_info_cache: Dict[str, Dict] = {}

# BirdNET's label set includes several non-bird "event" classes (see
# BirdNET_GLOBAL_6K_V2.4_Labels.txt) used to recognize common background
# noise. These are not species and must never be logged as a detection.
NON_BIRD_LABELS = {
    "Dog",
    "Engine",
    "Environmental",
    "Fireworks",
    "Gun",
    "Human non-vocal",
    "Human vocal",
    "Human whistle",
    "Noise",
    "Power tools",
    "Siren",
}


def analyze_audio(filepath: str) -> List[Dict]:
    """
    Analyze an audio file using BirdNET to detect bird species.

    Args:
        filepath: Path to the audio file (.wav)

    Returns:
        List of detection dictionaries with keys: species_common, species_scientific,
        confidence, start_time, end_time. Returns empty list on error.
    """
    try:
        # Import birdnetlib here to handle cases where it's not installed
        from birdnetlib import Recording
        from birdnetlib.analyzer import Analyzer

        analyzer = Analyzer()


        recording = Recording(
            path=filepath,
            analyzer=analyzer,
            lat=LAT if LAT is not None else 0,
            lon=LON if LON is not None else 0,
            date=datetime.now(),
            min_conf=BIRDNET_CONFIDENCE_THRESHOLD
        )

        # Run the analysis
        recording.analyze()

        # Extract detections, dropping BirdNET's non-bird event classes
        # (Dog, Siren, Engine, Human, Noise, etc.) so they never get treated
        # as species sightings.
        detections = []
        for detection in recording.detections:
            if detection['common_name'] in NON_BIRD_LABELS:
                continue
            detections.append({
                'species_common': detection['common_name'],
                'species_scientific': detection['scientific_name'],
                'confidence': detection['confidence'],
                'start_time': detection['start_time'],
                'end_time': detection['end_time']
            })

        print(f"Analysis complete: {len(detections)} detections found in {filepath}")
        return detections
    
    except ImportError:
        print("Error: birdnetlib not installed. Install with: pip install birdnetlib")
        return []
    except Exception as e:
        print(f"Error analyzing audio file {filepath}: {e}")
        return []


WIKIPEDIA_USER_AGENT = "BirdWatch/1.0 (backyard bird tracker; tylerschnelker@yahoo.com)"


def _fetch_summary_by_title(title: str) -> Optional[Dict[str, Optional[str]]]:
    """
    Look up a Wikipedia page summary by exact title.

    Returns:
        Dict with keys image_url, wiki_summary on HTTP 200 (either may still be
        None if the page has no thumbnail/extract), or None on non-200/error.
    """
    try:
        url = f"https://en.wikipedia.org/api/rest_v1/page/summary/{urllib.parse.quote(title, safe='')}"
        response = requests.get(url, timeout=10, headers={"User-Agent": WIKIPEDIA_USER_AGENT})

        if response.status_code != 200:
            return None

        data = response.json()

        image_url = None
        if 'thumbnail' in data and 'source' in data['thumbnail']:
            image_url = data['thumbnail']['source']

        return {
            'image_url': image_url,
            'wiki_summary': data.get('extract', None)
        }
    except Exception as e:
        print(f"Error fetching Wikipedia summary for '{title}': {e}")
        return None


def _opensearch_resolve(query: str) -> Optional[str]:
    """
    Resolve a possibly-inexact name to the closest matching Wikipedia page
    title using the opensearch API (e.g. handles subspecies-qualified BirdNET
    names that don't exactly match a page title).
    """
    try:
        response = requests.get(
            "https://en.wikipedia.org/w/api.php",
            params={
                "action": "opensearch",
                "search": query,
                "limit": 1,
                "namespace": 0,
                "format": "json"
            },
            timeout=10,
            headers={"User-Agent": WIKIPEDIA_USER_AGENT}
        )

        if response.status_code != 200:
            return None

        data = response.json()
        titles = data[1] if len(data) > 1 else []
        return titles[0] if titles else None
    except Exception as e:
        print(f"Error resolving Wikipedia title for '{query}': {e}")
        return None


def _has_content(result: Optional[Dict[str, Optional[str]]]) -> bool:
    return bool(result) and (result.get('image_url') or result.get('wiki_summary'))


def fetch_bird_info(species_common: str, species_scientific: Optional[str] = None) -> Dict[str, Optional[str]]:
    """
    Fetch bird information from Wikipedia, trying a few fallbacks before
    giving up. BirdNET sometimes returns a name (often subspecies-qualified)
    that doesn't exactly match a Wikipedia page title, which used to leave the
    image/summary blank.

    Args:
        species_common: Common name of the bird species
        species_scientific: Optional scientific name, tried as a fallback

    Returns:
        Dictionary with keys: image_url, wiki_summary. Both are None if every
        fallback fails.
    """
    # Check cache first
    if species_common in bird_info_cache:
        return bird_info_cache[species_common]

    result = _fetch_summary_by_title(species_common)

    if not _has_content(result) and species_scientific:
        scientific_result = _fetch_summary_by_title(species_scientific)
        if _has_content(scientific_result):
            result = scientific_result

    if not _has_content(result):
        resolved_title = _opensearch_resolve(species_common)
        if resolved_title:
            resolved_result = _fetch_summary_by_title(resolved_title)
            if _has_content(resolved_result):
                result = resolved_result

    if result is None:
        result = {'image_url': None, 'wiki_summary': None}

    # Cache unconditionally (including misses) now that a lookup can involve
    # several requests - no point re-attempting a species that's genuinely
    # not on Wikipedia every time it's detected again.
    bird_info_cache[species_common] = result

    return result
