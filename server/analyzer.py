"""
Audio analysis using BirdNET-Analyzer for bird species identification.
Also fetches bird information from Wikipedia.
"""

import requests
from typing import List, Dict, Optional
from datetime import datetime

from config import BIRDNET_CONFIDENCE_THRESHOLD, LAT, LON

# In-memory cache for bird info to avoid hammering Wikipedia
bird_info_cache: Dict[str, Dict] = {}


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
            min_conf=BIRDNET_CONFIDENCE_THRESHOLD
        )
        
        # Run the analysis
        recording.analyze()
        
        # Extract detections
        detections = []
        for detection in recording.detections:
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


def fetch_bird_info(species_common: str) -> Dict[str, Optional[str]]:
    """
    Fetch bird information from Wikipedia API.
    
    Args:
        species_common: Common name of the bird species
    
    Returns:
        Dictionary with keys: image_url, wiki_summary. Both are None on error.
    """
    # Check cache first
    if species_common in bird_info_cache:
        return bird_info_cache[species_common]
    
    try:
        # Call Wikipedia REST API
        url = f"https://en.wikipedia.org/api/rest_v1/page/summary/{species_common}"
        response = requests.get(url, timeout=10, headers={
            "User-Agent": "BirdWatch/1.0 (backyard bird tracker; tylerschnelker@yahoo.com)"
        })
        
        if response.status_code == 200:
            data = response.json()
            
            # Extract image URL and summary
            image_url = None
            if 'thumbnail' in data and 'source' in data['thumbnail']:
                image_url = data['thumbnail']['source']
            
            wiki_summary = data.get('extract', None)
            
            result = {
                'image_url': image_url,
                'wiki_summary': wiki_summary
            }
            
            # Cache the result
            bird_info_cache[species_common] = result
            
            return result
        else:
            print(f"Wikipedia API returned status {response.status_code} for {species_common}")
            return {'image_url': None, 'wiki_summary': None}
    
    except Exception as e:
        print(f"Error fetching bird info for {species_common}: {e}")
        return {'image_url': None, 'wiki_summary': None}
