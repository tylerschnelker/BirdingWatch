"""
Rotating species photos and descriptions, so a species seen every day doesn't
show the same Wikipedia lead photo and intro paragraph every day.

- Photos: a pool of up to PHOTO_POOL_SIZE community photos per species from
  iNaturalist's research-grade observations (most-faved first), limited to
  Creative Commons licenses that allow reuse with credit. The credit is shown
  under the card.
- Descriptions: the species' Wikipedia article split into its sections
  (Description, Diet, Nesting, ...). The article is the one iNaturalist links
  to the taxon, which avoids common-name ambiguity ("Bushtit" redirects to the
  whole family on Wikipedia; iNaturalist points at "American bushtit").

Both are cached in the species_media table and refreshed every
REFRESH_SECONDS by a background thread, so page loads never wait on either
API. Each day picks the next photo/section in the pool, offset per species, so
the same species shows the same thing all day, a past day keeps showing what it
showed, and a pool only repeats once it's been cycled through.
"""

import hashlib
import json
import queue
import re
import threading
import time
from datetime import date
from typing import Dict, List, Optional, Tuple

import requests

from database import get_all_species_media, upsert_species_media, get_all_species_names

USER_AGENT = "BirdWatch/1.0 (backyard bird tracker; tylerschnelker@yahoo.com)"
PHOTO_POOL_SIZE = 50
REFRESH_SECONDS = 30 * 24 * 3600
# A lookup that came back empty (API down, or genuinely nothing) is retried sooner.
EMPTY_RETRY_SECONDS = 24 * 3600
# iNaturalist asks API users to stay around 1 request/second.
SECONDS_BETWEEN_SPECIES = 3

# Licenses that allow reuse with attribution. "All rights reserved" photos are
# excluded by not listing them.
ALLOWED_LICENSES = ["cc0", "cc-by", "cc-by-sa", "cc-by-nc", "cc-by-nc-sa", "cc-by-nd", "cc-by-nc-nd"]

SKIP_SECTIONS = {
    "references", "external links", "further reading", "notes", "footnotes",
    "see also", "bibliography", "sources", "citations", "gallery", "cited texts",
    "works cited", "literature cited", "general references", "cited sources",
}
# Dry, mostly-Latin sections that make a poor daily blurb (matched as substrings,
# so "Taxonomy and systematics" is skipped too).
SKIP_SECTION_WORDS = ("taxonomy", "subspecies", "systematics", "phylogeny", "classification")
MIN_SECTION_CHARS = 200
MAX_SECTION_CHARS = 1200

HEADING_RE = re.compile(r"^(={2,6})\s*(.+?)\s*\1\s*$", re.MULTILINE)

_refresh_queue: "queue.Queue[Tuple[str, Optional[str]]]" = queue.Queue()
_pending = set()
_pending_lock = threading.Lock()
_worker_started = False


def _get_json(url: str, params: Dict) -> Optional[Dict]:
    try:
        response = requests.get(url, params=params, timeout=15, headers={"User-Agent": USER_AGENT})
        if response.status_code != 200:
            print(f"species_media: {url} returned {response.status_code}")
            return None
        return response.json()
    except Exception as e:
        print(f"species_media: error fetching {url}: {e}")
        return None


def _find_inat_taxon(species_common: str, species_scientific: Optional[str]) -> Optional[Dict]:
    """
    Match the species to an iNaturalist taxon, by exact scientific name first
    (unambiguous), then by common name.
    """
    for query in [species_scientific, species_common]:
        if not query:
            continue
        data = _get_json("https://api.inaturalist.org/v1/taxa", {
            "q": query, "rank": "species", "is_active": "true", "per_page": 5
        })
        time.sleep(1)
        results = (data or {}).get("results", [])
        for taxon in results:
            # matched_term covers synonyms, e.g. BirdNET's "Cordilleran Flycatcher"
            # was lumped into Western Flycatcher on iNaturalist.
            names = {(taxon.get(k) or "").lower() for k in ("name", "preferred_common_name", "matched_term")}
            if query.lower() in names:
                return taxon
    return None


def _fetch_inat_photos(taxon_id: int) -> List[Dict]:
    data = _get_json("https://api.inaturalist.org/v1/observations", {
        "taxon_id": taxon_id,
        "quality_grade": "research",
        "photos": "true",
        "photo_license": ",".join(ALLOWED_LICENSES),
        "order_by": "votes",
        "per_page": PHOTO_POOL_SIZE,
    })
    photos = []
    seen = set()
    for obs in (data or {}).get("results", []):
        for photo in obs.get("photos", []):
            license_code = (photo.get("license_code") or "").lower()
            url = photo.get("url") or ""
            if license_code not in ALLOWED_LICENSES or "/square." not in url:
                continue
            url = url.replace("/square.", "/small.")
            if url in seen:
                break
            seen.add(url)
            user = obs.get("user") or {}
            photos.append({
                "url": url,
                "observer": user.get("name") or user.get("login") or "an iNaturalist observer",
                "license": license_code.upper(),
                "link": f"https://www.inaturalist.org/observations/{obs['id']}",
            })
            break  # one photo per observation, for variety
    return photos


def _wiki_title_from_url(url: Optional[str]) -> Optional[str]:
    if not url or "/wiki/" not in url:
        return None
    from urllib.parse import unquote
    return unquote(url.split("/wiki/", 1)[1]).replace("_", " ")


def _trim(text: str) -> str:
    """Keep whole paragraphs up to MAX_SECTION_CHARS, cutting a long one at a sentence."""
    paragraphs = [p.strip() for p in text.split("\n") if p.strip()]
    kept = []
    total = 0
    for p in paragraphs:
        if total and total + len(p) > MAX_SECTION_CHARS:
            break
        if len(p) > MAX_SECTION_CHARS:
            cut = p[:MAX_SECTION_CHARS]
            end = cut.rfind(". ")
            p = cut[:end + 1] if end > 0 else cut.rstrip() + "…"
        kept.append(p)
        total += len(p)
    return "\n\n".join(kept)


def _looks_like_prose(text: str) -> bool:
    # Skip list-like sections (subspecies lists, tables flattened to short lines).
    lines = [l for l in text.split("\n") if l.strip()]
    long_lines = [l for l in lines if len(l) >= 80]
    return len(long_lines) * 2 >= len(lines)


def _split_sections(extract: str) -> List[Dict[str, str]]:
    """
    Split a plaintext Wikipedia extract into {title, anchor, text} chunks.
    The lead (before the first heading) is titled "About". A heading whose own
    body is empty (only subsections) is dropped; its subsections stand alone.
    """
    sections = []
    matches = list(HEADING_RE.finditer(extract))
    lead = extract[:matches[0].start()] if matches else extract
    chunks = [("About", "", lead)]
    for i, m in enumerate(matches):
        end = matches[i + 1].start() if i + 1 < len(matches) else len(extract)
        chunks.append((m.group(2), m.group(2), extract[m.end():end]))

    for title, anchor, body in chunks:
        body = re.sub(r"[ \t]{2,}", " ", body).strip()
        if title.lower() in SKIP_SECTIONS or any(w in title.lower() for w in SKIP_SECTION_WORDS):
            continue
        if len(body) < MIN_SECTION_CHARS or not _looks_like_prose(body):
            continue
        sections.append({"title": title, "anchor": anchor.replace(" ", "_"), "text": _trim(body)})
    return sections


def _fetch_wiki_sections(title: str) -> Tuple[Optional[str], List[Dict[str, str]]]:
    data = _get_json("https://en.wikipedia.org/w/api.php", {
        "action": "query", "prop": "extracts", "explaintext": 1, "exsectionformat": "wiki",
        "redirects": 1, "format": "json", "formatversion": 2, "titles": title,
    })
    pages = (data or {}).get("query", {}).get("pages", [])
    if not pages or pages[0].get("missing") or not pages[0].get("extract"):
        return None, []
    return pages[0]["title"], _split_sections(pages[0]["extract"])


def refresh_species_media(species_common: str, species_scientific: Optional[str]) -> None:
    """Fetch and store one species' photo pool and description sections."""
    photos: List[Dict] = []
    wiki_candidates = []

    taxon = _find_inat_taxon(species_common, species_scientific)
    if taxon:
        photos = _fetch_inat_photos(taxon["id"])
        wiki_candidates.append(_wiki_title_from_url(taxon.get("wikipedia_url")))
    wiki_candidates += [species_scientific, species_common]

    wiki_title, sections = None, []
    for candidate in wiki_candidates:
        if not candidate:
            continue
        wiki_title, sections = _fetch_wiki_sections(candidate)
        if sections:
            break

    upsert_species_media(species_common, json.dumps(photos), json.dumps(sections),
                         wiki_title, int(time.time()))
    print(f"species_media: {species_common}: {len(photos)} photos, {len(sections)} sections ({wiki_title})")


def _worker() -> None:
    while True:
        species_common, species_scientific = _refresh_queue.get()
        try:
            refresh_species_media(species_common, species_scientific)
        except Exception as e:
            print(f"species_media: refresh failed for {species_common}: {e}")
        finally:
            with _pending_lock:
                _pending.discard(species_common)
        time.sleep(SECONDS_BETWEEN_SPECIES)


def request_refresh(species_common: str, species_scientific: Optional[str]) -> None:
    """Queue a background refresh for a species (deduplicated, never blocks)."""
    with _pending_lock:
        if species_common in _pending:
            return
        _pending.add(species_common)
    _refresh_queue.put((species_common, species_scientific))


def _needs_refresh(row: Optional[Dict]) -> bool:
    if row is None:
        return True
    age = time.time() - row["fetched_at"]
    empty = row["photos_json"] == "[]" or row["sections_json"] == "[]"
    return age > (EMPTY_RETRY_SECONDS if empty else REFRESH_SECONDS)


def start_background_refresh() -> None:
    """Start the worker and queue every known species that's missing or stale."""
    global _worker_started
    if _worker_started:
        return
    _worker_started = True
    threading.Thread(target=_worker, daemon=True, name="species-media").start()

    cached = get_all_species_media()
    for s in get_all_species_names():
        if _needs_refresh(cached.get(s["species_common"])):
            request_refresh(s["species_common"], s["species_scientific"])


def _pick(items: List, species_common: str, date_str: str):
    """
    Deterministic choice for this species on this day: consecutive days step
    through the list, offset per species so different birds aren't in lockstep.
    """
    if not items:
        return None
    try:
        day_number = date.fromisoformat(date_str).toordinal()
    except ValueError:
        day_number = date.today().toordinal()
    offset = int(hashlib.sha256(species_common.encode()).hexdigest()[:8], 16)
    return items[(day_number + offset) % len(items)]


def apply_daily_media(rows: List[Dict], date_str: str) -> None:
    """
    Fill in each row's photo and description for date_str, in place.

    Sets image_url (falling back to the row's stored Wikipedia photo),
    photo_credit {observer, license, link} or None, and fact
    {title, text, link} or None (the frontend falls back to wiki_summary).
    Species with missing or stale cache entries are queued for refresh.
    """
    cached = get_all_species_media()
    for row in rows:
        species = row["species_common"]
        media = cached.get(species)
        if _needs_refresh(media):
            request_refresh(species, row.get("species_scientific"))

        row["photo_credit"] = None
        row["fact"] = None
        if not media:
            continue

        photo = _pick(json.loads(media["photos_json"]), species, date_str)
        if photo:
            row["image_url"] = photo["url"]
            row["photo_credit"] = {k: photo[k] for k in ("observer", "license", "link")}

        section = _pick(json.loads(media["sections_json"]), species, date_str)
        if section:
            link = "https://en.wikipedia.org/wiki/" + (media["wiki_title"] or "").replace(" ", "_")
            if section["anchor"]:
                link += "#" + section["anchor"]
            row["fact"] = {"title": section["title"], "text": section["text"], "link": link}
