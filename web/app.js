// BirdWatch frontend logic

// Bird silhouette SVG for placeholder images
const BIRD_SILHOUETTE = `
<svg width="60" height="60" viewBox="0 0 60 60" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M30 10C20 10 15 20 15 25C15 30 18 35 20 38C18 40 15 42 12 43C10 44 8 46 8 48C8 50 10 52 15 52C20 52 25 50 28 48C30 50 35 52 40 52C45 52 48 50 48 48C48 46 46 44 44 43C41 42 38 40 36 38C38 35 41 30 41 25C41 20 36 10 30 10Z" fill="#b2bec3"/>
</svg>
`;

// Format date as "Today at 3:42 PM" or "Yesterday at 11:05 AM"
function formatDate(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    
    let datePrefix;
    if (dateOnly.getTime() === today.getTime()) {
        datePrefix = 'Today';
    } else if (dateOnly.getTime() === yesterday.getTime()) {
        datePrefix = 'Yesterday';
    } else {
        datePrefix = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
    
    const timeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    return `${datePrefix} at ${timeStr}`;
}

// Calculate duration in minutes between two ISO date strings
function calculateDurationMinutes(firstDetectedAt, lastDetectedAt) {
    const first = new Date(firstDetectedAt);
    const last = new Date(lastDetectedAt);
    const diffMs = last.getTime() - first.getTime();
    return Math.round(diffMs / (1000 * 60));
}

// Format duration as human-readable string
function formatDuration(minutes) {
    if (minutes < 1) return 'Just detected';
    if (minutes < 60) return `Visited for ${minutes} minute${minutes !== 1 ? 's' : ''}`;
    const hours = Math.floor(minutes / 60);
    const remainingMins = minutes % 60;
    if (remainingMins === 0) return `Visited for ${hours} hour${hours !== 1 ? 's' : ''}`;
    return `Visited for ${hours}h ${remainingMins}m`;
}

// Format a 'YYYY-MM-DD' string as "Today", "Yesterday", or "Mon, Jan 5"
function formatDayLabel(dateStr, serverTodayStr) {
    if (dateStr === serverTodayStr) return 'Today';

    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(y, m - 1, d);

    const [ty, tm, td] = serverTodayStr.split('-').map(Number);
    const yesterday = new Date(ty, tm - 1, td);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.getTime() === yesterday.getTime()) return 'Yesterday';

    return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

// Shift a 'YYYY-MM-DD' string by a number of days, parsed/formatted as local dates
function shiftDateString(dateStr, deltaDays) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    date.setDate(date.getDate() + deltaDays);

    const yy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yy}-${mm}-${dd}`;
}

// Escape text from outside sources (iNaturalist, Wikipedia) before it goes into innerHTML
function escapeHtml(text) {
    return String(text ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
}

// "First heard here Aug 24 · heard on 31 days" for a species day card
function formatBackyardLine(item) {
    if (item.is_first_ever || !item.first_heard_timestamp) return '';
    const first = new Date(item.first_heard_timestamp * 1000);
    const sameYear = first.getFullYear() === new Date().getFullYear();
    const firstStr = first.toLocaleDateString('en-US', sameYear
        ? { month: 'short', day: 'numeric' }
        : { month: 'short', day: 'numeric', year: 'numeric' });
    const days = item.days_heard || 1;
    return `First heard here ${firstStr} · heard on ${days} day${days !== 1 ? 's' : ''}`;
}

// "Back after 5 weeks" / "Back after 4 months" for a species returning after a long absence
function formatReturn(days) {
    if (days >= 60) return `Back after ${Math.round(days / 30)} months`;
    return `Back after ${Math.round(days / 7)} weeks`;
}

// Today's description: a rotating Wikipedia section, or the stored intro as a fallback
function renderFact(item) {
    if (item.fact) {
        return `
            <div class="wiki-summary collapsed">
                <span class="fact-label">${escapeHtml(item.fact.title)}</span>
                ${escapeHtml(item.fact.text).replace(/\n\n/g, '<br><br>')}
                <a class="fact-source" href="${escapeHtml(item.fact.link)}" target="_blank" rel="noopener">Wikipedia</a>
            </div>
            <button class="expand-button summary-toggle">Read more</button>
        `;
    }
    if (item.wiki_summary) {
        return `
            <div class="wiki-summary collapsed">
                ${escapeHtml(item.wiki_summary)}
            </div>
            <button class="expand-button summary-toggle">Read more</button>
        `;
    }
    return '';
}

function renderPhotoCredit(credit) {
    if (!credit) return '';
    return `<a class="photo-credit" href="${escapeHtml(credit.link)}" target="_blank" rel="noopener">📷 ${escapeHtml(credit.observer)} · iNaturalist (${escapeHtml(credit.license)})</a>`;
}

// Create bird image element with fallback to silhouette
function createBirdImage(imageUrl, size = 'large') {
    const img = document.createElement('div');
    const width = size === 'large' ? 128 : 60;
    const height = size === 'large' ? 128 : 60;
    
    img.style.width = `${width}px`;
    img.style.height = `${height}px`;
    img.className = size === 'large' ? 'bird-photo' : 'species-thumbnail';
    
    if (imageUrl) {
        const imgEl = document.createElement('img');
        // iNaturalist's "small" (240px) is soft at 128px on a phone; cards use "medium" (500px)
        imgEl.src = size === 'large' ? imageUrl.replace(/\/small\.(jpe?g|png)$/, '/medium.$1') : imageUrl;
        imgEl.loading = 'lazy';
        imgEl.alt = 'Bird';
        imgEl.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:8px;';
        imgEl.onerror = function() { this.parentElement.innerHTML = BIRD_SILHOUETTE; };
        img.appendChild(imgEl);    
    } else {
        img.className += ' placeholder';
        img.innerHTML = BIRD_SILHOUETTE;
    }
    
    return img;
}

// Render a day card for one species (aggregate of that day's visits)
function renderSpeciesDayCard(item, dateStr) {
    const card = document.createElement('div');
    card.className = 'detection-card species-day-card';
    card.dataset.species = item.species_common;
    card.dataset.date = dateStr;

    const confidencePercent = Math.round(item.best_confidence * 100);
    const lastSeen = formatDate(item.last_seen_at);
    const backyardLine = formatBackyardLine(item);

    if (item.is_first_ever) {
        card.classList.add('first-ever-card');
    }

    card.innerHTML = `
        ${item.is_first_ever ? `<div class="first-ever-banner">🎉 First time ever!</div>` : ''}
        ${item.returned_after_days ? `<div class="returned-banner">${formatReturn(item.returned_after_days)}</div>` : ''}
        <div class="card-header">
            ${createBirdImage(item.image_url, 'large').outerHTML}
            <div class="bird-info">
                <div class="bird-name">${item.species_common}</div>
                <div class="bird-scientific">${item.species_scientific}</div>
                <span class="confidence-badge">Best confidence: ${confidencePercent}%</span>
                <span class="detection-count-badge">🎵 ${item.total_calls} call${item.total_calls !== 1 ? 's' : ''}</span>
                <span class="visit-count-badge">📍 ${item.visit_count} visit${item.visit_count !== 1 ? 's' : ''}</span>
                ${renderPhotoCredit(item.photo_credit)}
            </div>
        </div>
        <div class="card-meta">
            <div class="detection-time"><span>🕐</span><span>Last: ${lastSeen}</span></div>
            ${backyardLine ? `<div class="backyard-line"><span>🏡</span><span>${backyardLine}</span></div>` : ''}
        </div>
        ${renderFact(item)}
        <div class="audio-player-container">
            ${item.audio_filename
                ? `<audio controls src="/api/audio/${item.audio_filename}" onerror="this.replaceWith(Object.assign(document.createElement('span'), {className: 'audio-unavailable-note', textContent: 'Audio no longer available'}))"></audio>`
                : `<span class="audio-unavailable-note">Audio no longer available</span>`}
        </div>
        <div class="card-actions">
            <button class="expand-button visits-toggle">Show ${item.visit_count} visit${item.visit_count !== 1 ? 's' : ''}</button>
            ${isOwner() ? '<button class="wrong-bird">Wrong bird?</button>' : ''}
        </div>
        <div class="visits-list collapsed"></div>
    `;

    // Species names can contain characters (apostrophes, etc.) that aren't
    // safe to interpolate into onclick="..."/id="..." strings (e.g. "Cooper's
    // Hawk"), so wire these up directly instead.
    card.querySelector('.visits-toggle').addEventListener('click', () => toggleVisits(item.species_common, dateStr, card));
    const wrong = card.querySelector('.wrong-bird');
    if (wrong) wrong.addEventListener('click', () => hideDaySpecies(item, dateStr));

    const photo = card.querySelector('.bird-photo img');
    if (photo) {
        photo.addEventListener('click', () => openPhotoViewer(photo.src, item.species_common, item.photo_credit));
    }

    const summaryToggle = card.querySelector('.summary-toggle');
    if (summaryToggle) {
        summaryToggle.addEventListener('click', () => toggleSummary(card));
    }

    return card;
}

// Full-screen view of a card's photo; tap anywhere to close
function openPhotoViewer(src, speciesName, credit) {
    const overlay = document.createElement('div');
    overlay.className = 'photo-viewer';
    overlay.innerHTML = `
        <img src="${escapeHtml(src)}" alt="${escapeHtml(speciesName)}">
        <div class="photo-viewer-caption">
            <div class="photo-viewer-name">${escapeHtml(speciesName)}</div>
            ${renderPhotoCredit(credit)}
        </div>
    `;
    overlay.addEventListener('click', event => {
        if (!event.target.closest('a')) overlay.remove();
    });
    document.body.appendChild(overlay);
}

// Toggle wiki summary expansion within a species day card
function toggleSummary(card) {
    const summary = card.querySelector('.wiki-summary');
    const button = card.querySelector('.summary-toggle');

    if (summary.classList.contains('collapsed')) {
        summary.classList.remove('collapsed');
        button.textContent = 'Show less';
    } else {
        summary.classList.add('collapsed');
        button.textContent = 'Read more';
    }
}

// Render a single visit row (one session) inside an expanded species day card
function renderVisitRow(visit) {
    const row = document.createElement('div');
    row.className = 'visit-row';
    row.dataset.id = visit.id;

    const confidencePercent = Math.round(visit.confidence * 100);
    const formattedFirstDate = formatDate(visit.first_detected_at);
    const formattedLastDate = formatDate(visit.last_detected_at);
    const durationMinutes = calculateDurationMinutes(visit.first_detected_at, visit.last_detected_at);
    const durationText = formatDuration(durationMinutes);

    let timeInfo = '';
    if (durationMinutes <= 1) {
        timeInfo = `<div class="detection-time"><span>🕐</span><span>${formattedLastDate}</span></div>`;
    } else {
        timeInfo = `
            <div class="detection-time"><span>🕐</span><span>First: ${formattedFirstDate}, Last: ${formattedLastDate}</span></div>
            <div class="detection-duration"><span>⏱️</span><span>${durationText}</span></div>
        `;
    }

    row.innerHTML = `
        <div class="card-meta">
            ${timeInfo}
            <span class="detection-count-badge">🎵 ${visit.detection_count} call${visit.detection_count !== 1 ? 's' : ''}</span>
            <span class="confidence-badge">${confidencePercent}%</span>
        </div>
        <div class="audio-player-container">
            ${visit.audio_available
                ? `<audio controls src="/api/audio/${visit.audio_filename}" onerror="this.replaceWith(Object.assign(document.createElement('span'), {className: 'audio-unavailable-note', textContent: 'Audio no longer available'}))"></audio>`
                : `<span class="audio-unavailable-note">Audio no longer available</span>`}
            ${isOwner() ? `<button class="hide-button" onclick="hideVisit(${Number(visit.id)}, this)">Hide</button>` : ''}
        </div>
    `;

    return row;
}

// Lazily fetch and expand/collapse the individual visits for one species+day
async function toggleVisits(speciesCommon, dateStr, cardEl) {
    const list = cardEl.querySelector('.visits-list');
    const toggleBtn = cardEl.querySelector('.visits-toggle');

    if (!list.classList.contains('collapsed')) {
        list.classList.add('collapsed');
        toggleBtn.textContent = toggleBtn.dataset.showLabel || toggleBtn.textContent.replace('Hide', 'Show');
        return;
    }

    if (!list.dataset.loaded) {
        list.innerHTML = '<div class="loading">Loading visits...</div>';
        list.classList.remove('collapsed');
        try {
            const response = await fetch(`/api/days/${dateStr}/species/${encodeURIComponent(speciesCommon)}`);
            const data = await response.json();

            list.innerHTML = '';
            data.visits.forEach(visit => list.appendChild(renderVisitRow(visit)));
            list.dataset.loaded = 'true';
        } catch (error) {
            console.error('Error loading visits:', error);
            list.innerHTML = '<div class="empty-state-subtext">Error loading visits</div>';
        }
    } else {
        list.classList.remove('collapsed');
    }

    toggleBtn.dataset.showLabel = toggleBtn.textContent;
    toggleBtn.textContent = 'Hide visits';
}

// ---- Owner editing: hide misidentified visits (reversible) ----
// The key lives only in this browser (localStorage). A device is unlocked by
// opening the site once with #owner=<key>; the fragment never reaches the server.

const OWNER_KEY_STORAGE = 'bw-owner-key';

function isOwner() {
    return !!localStorage.getItem(OWNER_KEY_STORAGE);
}

function ownerFetch(url, options = {}) {
    return fetch(url, { ...options, headers: { ...(options.headers || {}), 'X-Admin-Key': localStorage.getItem(OWNER_KEY_STORAGE) || '' } });
}

async function unlockFromLink() {
    const match = location.hash.match(/owner=([^&]+)/);
    if (!match) return;
    history.replaceState(null, '', location.pathname + location.search);
    const key = decodeURIComponent(match[1]);
    const response = await fetch('/api/owner/check', { headers: { 'X-Admin-Key': key } });
    if (response.ok) {
        localStorage.setItem(OWNER_KEY_STORAGE, key);
        alert('Editing is unlocked on this device. Hide wrong birds from a bird\'s card; restore them in Settings.');
    } else {
        alert('That unlock link is not valid.');
    }
}

// After hiding or restoring, redraw everything that counts visits
function refreshAfterEdit() {
    loadDayView();
    loadSpecies();
}

async function hideVisit(detectionId, button) {
    button.disabled = true;
    const response = await ownerFetch(`/api/detections/${detectionId}/hide`, { method: 'POST' });
    if (!response.ok) {
        button.disabled = false;
        alert(response.status === 403 ? 'This device is no longer unlocked.' : 'Could not hide that visit.');
        return;
    }
    button.closest('.visit-row').remove();
    refreshAfterEdit();
}

async function hideDaySpecies(item, dateStr) {
    const visits = `${item.visit_count} visit${item.visit_count !== 1 ? 's' : ''}`;
    if (!confirm(`Hide ${item.species_common} (${visits}) on this day as a wrong ID? You can restore it in Settings.`)) return;
    const response = await ownerFetch(`/api/days/${dateStr}/species/${encodeURIComponent(item.species_common)}/hide`, { method: 'POST' });
    if (!response.ok) {
        alert(response.status === 403 ? 'This device is no longer unlocked.' : 'Could not hide that bird.');
        return;
    }
    document.querySelector('.sheet-backdrop .sheet-close')?.click();
    refreshAfterEdit();
}

// Settings > Hidden visits: restore any of them
async function openHiddenList() {
    const content = document.createElement('div');
    content.className = 'settings';
    content.innerHTML = '<h2 class="sheet-title">Hidden visits</h2><div class="group hidden-list"><div class="row"><span class="row-value">Loading…</span></div></div><p class="group-footer">Hidden visits don\'t count anywhere. Restore one to bring it back.</p>';
    openSheet(content, 'sheet-settings');
    const list = content.querySelector('.hidden-list');
    const response = await ownerFetch('/api/hidden');
    if (!response.ok) {
        list.innerHTML = '<div class="row"><span class="row-value">This device is no longer unlocked.</span></div>';
        return;
    }
    const hidden = await response.json();
    if (!hidden.length) {
        list.innerHTML = '<div class="row"><span class="row-value">Nothing hidden</span></div>';
        return;
    }
    list.innerHTML = hidden.map(h => `
        <div class="row">
            <span>
                <span class="row-title">${escapeHtml(h.species_common)}</span>
                <span class="row-sub">${new Date(h.last_detected_timestamp * 1000).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Denver' })} · ${h.detection_count} call${h.detection_count !== 1 ? 's' : ''} · ${Math.round(h.confidence * 100)}%</span>
            </span>
            <button class="restore-button" data-id="${Number(h.id)}">Restore</button>
        </div>`).join('');
    list.querySelectorAll('.restore-button').forEach(button => button.addEventListener('click', async () => {
        button.disabled = true;
        const r = await ownerFetch(`/api/hidden/${button.dataset.id}/restore`, { method: 'POST' });
        if (r.ok) {
            button.textContent = 'Restored';
            refreshAfterEdit();
        } else {
            button.disabled = false;
        }
    }));
}

// Render species list item
function renderSpeciesItem(species) {
    const item = document.createElement('div');
    item.className = 'species-item';
    
    const lastSeen = formatDate(species.last_seen);
    const avgDetections = species.avg_detections ? Math.round(species.avg_detections) : 1;
    const maxDuration = species.max_duration_minutes ? Math.round(species.max_duration_minutes) : 0;
    const durationText = maxDuration < 1 ? 'Less than 1 min' : 
                         maxDuration < 60 ? `${maxDuration} min` : 
                         `${Math.floor(maxDuration / 60)}h ${maxDuration % 60}m`;
    
    item.innerHTML = `
        ${createBirdImage(species.image_url, 'small').outerHTML}
        <div class="species-details">
            <div class="species-name">${escapeHtml(species.species_common)}</div>
            <div class="species-stats">
                <div class="stat-item">
                    <span>🔢</span>
                    <span class="visit-count">${species.total_sessions}</span>
                    <span>visit${species.total_sessions !== 1 ? 's' : ''}</span>
                </div>
                <div class="stat-item">
                    <span>🎵</span>
                    <span>Avg ${avgDetections} calls/visit</span>
                </div>
                <div class="stat-item">
                    <span>⏱️</span>
                    <span>Longest: ${durationText}</span>
                </div>
                <div class="stat-item">
                    <span>🕐</span>
                    <span>Last: ${lastSeen}</span>
                </div>
            </div>
        </div>
        ${species.best_audio_filename ? '<button class="species-play" aria-label="Play its best recording"></button>' : ''}
    `;

    const play = item.querySelector('.species-play');
    if (play) play.addEventListener('click', () => toggleClip(play, species.best_audio_filename));

    return item;
}

// The All species tab's ▶ buttons: one clip at a time
let listClip = null;

function stopListClip() {
    if (!listClip) return;
    listClip.audio.pause();
    listClip.button.classList.remove('playing');
    listClip = null;
}

function toggleClip(button, filename) {
    const wasThis = listClip && listClip.button === button;
    stopListClip();
    if (wasThis) return;
    if (typeof stopBathAudio === 'function') stopBathAudio();
    const audio = new Audio(`/api/audio/${encodeURIComponent(filename)}`);
    listClip = { audio, button };
    audio.addEventListener('ended', stopListClip);
    audio.addEventListener('error', stopListClip);
    audio.play().then(() => button.classList.add('playing')).catch(stopListClip);
}

const DAY_SECONDS = 86400;

// "Back for the season" and "Gone quiet" above the full list
function renderComingsAndGoings(species) {
    const now = Date.now() / 1000;
    const today = serverTodayDate ? new Date(`${serverTodayDate}T12:00:00`) : new Date();
    const back = species
        .filter(s => s.returned_on && (today - new Date(`${s.returned_on}T12:00:00`)) / 1000 / DAY_SECONDS <= 30
            && now - s.last_seen_timestamp <= 14 * DAY_SECONDS)
        .sort((a, b) => b.returned_on.localeCompare(a.returned_on));
    const quiet = species
        .filter(s => s.days_heard >= 10 && now - s.last_seen_timestamp > 14 * DAY_SECONDS && now - s.last_seen_timestamp < 120 * DAY_SECONDS)
        .sort((a, b) => b.last_seen_timestamp - a.last_seen_timestamp);
    if (!back.length && !quiet.length) return null;

    const shortDate = ts => new Date(ts * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const row = (s, sub) => `
        <div class="moves-row">
            ${createBirdImage(s.image_url, 'small').outerHTML}
            <div><div class="moves-name">${escapeHtml(s.species_common)}</div><div class="moves-sub">${escapeHtml(sub)}</div></div>
        </div>`;
    const section = document.createElement('div');
    section.className = 'moves';
    section.innerHTML = `
        ${back.length ? `<div class="moves-card">
            <div class="moves-title">Back for the season</div>
            ${back.map(s => row(s, `${formatReturn(s.returned_after_days)} · ${shortDate(new Date(`${s.returned_on}T12:00:00`) / 1000)}`)).join('')}
        </div>` : ''}
        ${quiet.length ? `<div class="moves-card">
            <div class="moves-title">Gone quiet</div>
            ${quiet.map(s => row(s, `Not heard since ${shortDate(s.last_seen_timestamp)} · heard on ${s.days_heard} days`)).join('')}
        </div>` : ''}
    `;
    return section;
}

// Server-anchored date state for day navigation
let currentViewedDate = null;
let serverTodayDate = null;

// Fetch the server's local "today" once at startup, so day navigation is
// anchored to the server's timezone rather than the viewing browser's.
async function initToday() {
    try {
        const response = await fetch('/api/today');
        const data = await response.json();
        serverTodayDate = data.date;
        currentViewedDate = data.date;
    } catch (error) {
        console.error('Error fetching server date, falling back to browser date:', error);
        const now = new Date();
        const fallback = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        serverTodayDate = fallback;
        currentViewedDate = fallback;
    }
}

// Fetch and render the day-grouped, species-grouped feed for currentViewedDate
async function loadDayView() {
    const container = document.getElementById('detections-container');
    const label = document.getElementById('current-date-label');
    const nextBtn = document.getElementById('next-day-btn');

    const countEl = document.getElementById('day-species-count');

    if (label) label.textContent = formatDayLabel(currentViewedDate, serverTodayDate);
    if (nextBtn) nextBtn.disabled = currentViewedDate === serverTodayDate;
    // Blank the count when switching days so the old day's number never sits
    // under the new day's label; the 30s refresh of the same day keeps it.
    if (countEl && countEl.dataset.date !== currentViewedDate) countEl.textContent = '';

    try {
        const response = await fetch(`/api/days/${currentViewedDate}`);
        const data = await response.json();

        container.innerHTML = '';
        renderBirdbath(data, currentViewedDate, currentViewedDate === serverTodayDate);

        // /api/days/{date} returns one entry per species, so its length is the day's species count
        const speciesCount = data.species ? data.species.length : 0;
        if (countEl) {
            countEl.dataset.date = currentViewedDate;
            countEl.textContent = speciesCount === 0
                ? (currentViewedDate === serverTodayDate ? 'No species heard yet' : 'No species heard')
                : `${speciesCount} species heard`;
        }

        if (!data.species || data.species.length === 0) {
            const dayLabel = formatDayLabel(currentViewedDate, serverTodayDate);
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">🐦</div>
                    <div class="empty-state-text">No detections ${dayLabel === 'Today' ? 'yet' : 'on this day'}</div>
                    <div class="empty-state-subtext">Bird calls will appear here once detected</div>
                </div>
            `;
            return;
        }

        data.species.forEach(item => {
            container.appendChild(renderSpeciesDayCard(item, currentViewedDate));
        });
    } catch (error) {
        console.error('Error loading day view:', error);
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-text">Error loading detections</div>
                <div class="empty-state-subtext">Please refresh the page</div>
            </div>
        `;
    }
}

// Wire up the prev/next day navigation buttons
function setupDateNav() {
    const prevBtn = document.getElementById('prev-day-btn');
    const nextBtn = document.getElementById('next-day-btn');

    prevBtn.addEventListener('click', () => {
        currentViewedDate = shiftDateString(currentViewedDate, -1);
        loadDayView();
    });

    nextBtn.addEventListener('click', () => {
        if (currentViewedDate === serverTodayDate) return;
        currentViewedDate = shiftDateString(currentViewedDate, 1);
        loadDayView();
    });
}

// Fetch and render species summary
async function loadSpecies() {
    const container = document.getElementById('species-container');
    
    try {
        const response = await fetch('/api/species');
        const species = await response.json();
        
        container.innerHTML = '';
        
        if (species.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">🐦</div>
                    <div class="empty-state-text">No species detected yet</div>
                    <div class="empty-state-subtext">Species will appear here once detected</div>
                </div>
            `;
            return;
        }
        
        const moves = renderComingsAndGoings(species);
        if (moves) container.appendChild(moves);
        const heading = document.createElement('div');
        heading.className = 'list-heading';
        heading.textContent = `All species · ${species.length}`;
        container.appendChild(heading);

        species.forEach(speciesItem => {
            container.appendChild(renderSpeciesItem(speciesItem));
        });
    } catch (error) {
        console.error('Error loading species:', error);
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-text">Error loading species</div>
                <div class="empty-state-subtext">Please refresh the page</div>
            </div>
        `;
    }
}

// Tab switching logic
function setupTabs() {
    const tabButtons = document.querySelectorAll('.tab-button');
    const tabContents = document.querySelectorAll('.tab-content');
    
    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            // Remove active class from all buttons and contents
            tabButtons.forEach(btn => btn.classList.remove('active'));
            tabContents.forEach(content => content.classList.remove('active'));
            
            // Add active class to clicked button
            button.classList.add('active');
            
            // Show corresponding tab content
            const tabId = button.getAttribute('data-tab');
            document.getElementById(`${tabId}-tab`).classList.add('active');

            // The day arrows drive the birdbath and the list, not the all-species tab
            document.getElementById('date-nav').hidden = tabId === 'species';
            if (tabId !== 'birdbath') stopBathAudio();
            if (tabId !== 'species') stopListClip();
        });
    });
}

// Sheet from the bottom (a centred card on an iPad) holding `content`
function openSheet(content, className = '') {
    const backdrop = document.createElement('div');
    backdrop.className = 'sheet-backdrop';
    backdrop.innerHTML = `<div class="sheet ${className}" role="dialog" aria-modal="true"><button class="sheet-close" aria-label="Close">✕</button></div>`;
    const sheet = backdrop.querySelector('.sheet');
    sheet.appendChild(content);
    const close = () => {
        backdrop.classList.remove('open');
        document.body.classList.remove('sheet-open');
        setTimeout(() => backdrop.remove(), 250);
    };
    backdrop.addEventListener('click', event => { if (event.target === backdrop) close(); });
    sheet.querySelector('.sheet-close').addEventListener('click', close);
    document.body.appendChild(backdrop);
    document.body.classList.add('sheet-open');
    requestAnimationFrame(() => backdrop.classList.add('open'));
    return sheet;
}

// Convert a base64url VAPID public key string into the Uint8Array format
// pushManager.subscribe() requires for applicationServerKey.
function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; i++) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

function pushSupported() {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

// iPadOS Safari reports itself as a Mac, so also check for touch
function isAppleMobile() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent)
        || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

async function getPushSubscription() {
    const registration = await navigator.serviceWorker.ready;
    return registration.pushManager.getSubscription();
}

// Subscribe or unsubscribe this browser. Throws an Error whose message can be
// shown to the user.
async function setNotifications(on) {
    const registration = await navigator.serviceWorker.ready;
    const existingSubscription = await registration.pushManager.getSubscription();

    if (!on) {
        if (!existingSubscription) return;
        try {
            await existingSubscription.unsubscribe();
            await fetch('/api/push/subscribe', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ endpoint: existingSubscription.endpoint })
            });
        } catch (error) {
            console.error('Error unsubscribing from notifications:', error);
        }
        return;
    }

    if (existingSubscription) return;
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
        throw new Error('Notifications are blocked for this site. You can allow them in your browser or device settings.');
    }

    const keyResponse = await fetch('/api/push/vapid-public-key');
    if (!keyResponse.ok) throw new Error("Notifications aren't set up on the server yet.");
    const { publicKey } = await keyResponse.json();

    try {
        const subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(publicKey)
        });
        await fetch('/api/push/subscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(subscription.toJSON())
        });
    } catch (error) {
        console.error('Error subscribing to notifications:', error);
        throw new Error('Could not turn on notifications. Please try again.');
    }
}

const NOTIFY_ABOUT = 'Get a notification when a bird visits the backyard for the first time ever, when a regular comes back after weeks away, or if the recorder goes offline.';

// Settings sheet (the gear in the header): notifications and recorder status
async function openSettings() {
    const content = document.createElement('div');
    content.className = 'settings';
    content.innerHTML = `
        <h2 class="sheet-title">Settings</h2>
        <div class="group-label">Notifications</div>
        <div class="group">
            <label class="row">
                <span class="row-title">Bird alerts</span>
                <input type="checkbox" class="switch" id="notify-switch" role="switch">
            </label>
        </div>
        <p class="group-footer" id="notify-footer"></p>
        <div class="group-label">Backyard recorder</div>
        <div class="group">
            <div class="row">
                <span class="row-title">Status</span>
                <span class="row-value" id="settings-recorder"></span>
            </div>
        </div>
        <p class="group-footer">Birds are identified from their calls with BirdNET.</p>
        ${isOwner() ? `
        <div class="group-label">Editing</div>
        <div class="group">
            <button class="row row-button" id="hidden-visits-btn"><span class="row-title">Hidden visits</span><span class="row-value">›</span></button>
            <button class="row row-button" id="lock-device-btn"><span class="row-title danger">Lock this device</span></button>
        </div>
        <p class="group-footer">This device can hide wrong IDs from a bird's card.</p>` : ''}
    `;
    content.querySelector('#settings-recorder').textContent = document.getElementById('recorder-status-text').textContent;
    openSheet(content, 'sheet-settings');

    content.querySelector('#hidden-visits-btn')?.addEventListener('click', openHiddenList);
    content.querySelector('#lock-device-btn')?.addEventListener('click', () => {
        localStorage.removeItem(OWNER_KEY_STORAGE);
        document.querySelector('.sheet-backdrop .sheet-close')?.click();
        refreshAfterEdit();
    });

    const toggle = content.querySelector('#notify-switch');
    const footer = content.querySelector('#notify-footer');
    footer.textContent = NOTIFY_ABOUT;

    if (!pushSupported()) {
        toggle.disabled = true;
        footer.textContent = isAppleMobile()
            ? 'To get notifications on an iPad or iPhone, open this page in Safari, tap the Share button, choose “Add to Home Screen”, then open BirdWatch from the Home Screen and come back here.'
            : "This browser doesn't support notifications.";
        return;
    }

    toggle.disabled = true;
    toggle.checked = !!(await getPushSubscription());
    toggle.disabled = false;

    toggle.addEventListener('change', async () => {
        toggle.disabled = true;
        try {
            await setNotifications(toggle.checked);
            footer.textContent = NOTIFY_ABOUT;
        } catch (error) {
            footer.textContent = error.message;
        }
        toggle.checked = !!(await getPushSubscription());
        toggle.disabled = false;
    });
}

function formatAgo(seconds) {
    if (seconds < 90) return 'just now';
    const minutes = Math.round(seconds / 60);
    if (minutes < 90) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 36) return `${hours} hr ago`;
    return `${Math.round(hours / 24)} days ago`;
}

// Header indicator driven by the Pi's heartbeats/uploads, so it's obvious at a
// glance when the recorder has gone dark instead of the feed just looking quiet.
async function loadRecorderStatus() {
    const el = document.getElementById('recorder-status');
    const textEl = document.getElementById('recorder-status-text');
    if (!el || !textEl) return;

    let state = 'unknown';
    let text = 'Recorder status unknown';
    try {
        const response = await fetch('/api/recorder-status');
        if (response.ok) {
            const s = await response.json();
            const recordingAgo = s.seconds_since_recording;
            const contactAgo = s.seconds_since_contact;

            if (recordingAgo !== null && recordingAgo < 180) {
                state = 'ok';
                text = s.pending_clips > 0 ? `Recording · catching up (${s.pending_clips})` : 'Recording';
            } else if (contactAgo !== null && contactAgo < 180) {
                state = 'warn';
                text = 'Online · mic not capturing';
            } else if (contactAgo === null && recordingAgo === null) {
                state = 'unknown';
                text = 'Waiting for recorder…';
            } else {
                const lastSeen = Math.min(...[contactAgo, recordingAgo].filter(v => v !== null));
                state = lastSeen < s.offline_after_seconds ? 'warn' : 'offline';
                text = state === 'warn'
                    ? `Recorder last heard ${formatAgo(lastSeen)}`
                    : `Recorder offline · last heard ${formatAgo(lastSeen)}`;
            }
        }
    } catch (e) {
        console.error('Error loading recorder status:', e);
    }

    el.className = `live-indicator status-${state}`;
    textEl.textContent = text;
}

// Initialize app
async function init() {
    await unlockFromLink();
    setupTabs();
    setupDateNav();
    setupBirdbath();
    await initToday();
    loadDayView();
    loadSpecies();
    document.getElementById('settings-btn').addEventListener('click', openSettings);
    loadRecorderStatus();

    // Auto-refresh every 30 seconds. Only the "today" view can change, so
    // don't bother re-fetching a past day the user is browsing.
    setInterval(() => {
        loadRecorderStatus();
        const activeTab = document.querySelector('.tab-button.active').getAttribute('data-tab');
        if (activeTab === 'birdbath' || activeTab === 'recent') {
            if (currentViewedDate === serverTodayDate) {
                loadDayView();
            }
        } else if (!listClip) {
            loadSpecies();
        }
    }, 30000);
}

// Run on page load
document.addEventListener('DOMContentLoaded', init);
