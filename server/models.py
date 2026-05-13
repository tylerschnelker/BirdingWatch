"""
Data models for bird detections.
"""

from dataclasses import dataclass
from datetime import datetime
from typing import Optional


@dataclass
class Detection:
    """
    Represents a single bird detection from audio analysis.
    """
    id: int
    species_common: str
    species_scientific: str
    confidence: float
    audio_filename: str
    detected_at: datetime
    image_url: Optional[str] = None
    wiki_summary: Optional[str] = None
