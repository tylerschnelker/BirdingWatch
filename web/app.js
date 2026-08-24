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

// Create bird image element with fallback to silhouette
function createBirdImage(imageUrl, size = 'large') {
    const img = document.createElement('div');
    const width = size === 'large' ? 80 : 60;
    const height = size === 'large' ? 80 : 60;
    
    img.style.width = `${width}px`;
    img.style.height = `${height}px`;
    img.className = size === 'large' ? 'bird-photo' : 'species-thumbnail';
    
    if (imageUrl) {
        const imgEl = document.createElement('img');
        imgEl.src = imageUrl;
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

    if (item.is_first_ever) {
        card.classList.add('first-ever-card');
    }

    card.innerHTML = `
        ${item.is_first_ever ? `<div class="first-ever-banner">🎉 First time ever!</div>` : ''}
        <div class="card-header">
            ${createBirdImage(item.image_url, 'large').outerHTML}
            <div class="bird-info">
                <div class="bird-name">${item.species_common}</div>
                <div class="bird-scientific">${item.species_scientific}</div>
                <span class="confidence-badge">Best confidence: ${confidencePercent}%</span>
                <span class="detection-count-badge">🎵 ${item.total_calls} call${item.total_calls !== 1 ? 's' : ''}</span>
                <span class="visit-count-badge">📍 ${item.visit_count} visit${item.visit_count !== 1 ? 's' : ''}</span>
            </div>
        </div>
        <div class="card-meta">
            <div class="detection-time"><span>🕐</span><span>Last: ${lastSeen}</span></div>
        </div>
        ${item.wiki_summary ? `
            <div class="wiki-summary collapsed">
                ${item.wiki_summary}
            </div>
            <button class="expand-button summary-toggle">Read more</button>
        ` : ''}
        <div class="audio-player-container">
            ${item.audio_filename
                ? `<audio controls src="/api/audio/${item.audio_filename}" onerror="this.replaceWith(Object.assign(document.createElement('span'), {className: 'audio-unavailable-note', textContent: 'Audio no longer available'}))"></audio>`
                : `<span class="audio-unavailable-note">Audio no longer available</span>`}
        </div>
        <button class="expand-button visits-toggle">Show ${item.visit_count} visit${item.visit_count !== 1 ? 's' : ''}</button>
        <div class="visits-list collapsed"></div>
    `;

    // Species names can contain characters (apostrophes, etc.) that aren't
    // safe to interpolate into onclick="..."/id="..." strings (e.g. "Cooper's
    // Hawk"), so wire these up directly instead.
    card.querySelector('.visits-toggle').addEventListener('click', () => toggleVisits(item.species_common, dateStr, card));

    const summaryToggle = card.querySelector('.summary-toggle');
    if (summaryToggle) {
        summaryToggle.addEventListener('click', () => toggleSummary(card));
    }

    return card;
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
            <button class="delete-button" onclick="deleteDetection(${visit.id})" title="Delete visit">🗑️</button>
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

// Delete a single visit (session)
async function deleteDetection(detectionId) {
    if (!confirm('Are you sure you want to delete this visit?')) {
        return;
    }

    try {
        const response = await fetch(`/api/detections/${detectionId}`, {
            method: 'DELETE'
        });

        if (response.ok) {
            // Reload the whole day view so the parent card's counts/audio stay accurate
            await loadDayView();

            // Refresh the species summary tab too, if it's visible
            const speciesTab = document.querySelector('.tab-button[data-tab="species"]');
            if (speciesTab.classList.contains('active')) {
                loadSpecies();
            }
        } else {
            alert('Failed to delete detection');
        }
    } catch (error) {
        console.error('Error deleting detection:', error);
        alert('Error deleting detection');
    }
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
            <div class="species-name">${species.species_common}</div>
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
    `;
    
    return item;
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

    if (label) label.textContent = formatDayLabel(currentViewedDate, serverTodayDate);
    if (nextBtn) nextBtn.disabled = currentViewedDate === serverTodayDate;

    try {
        const response = await fetch(`/api/days/${currentViewedDate}`);
        const data = await response.json();

        container.innerHTML = '';

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
        });
    });
}

// Initialize app
async function init() {
    setupTabs();
    setupDateNav();
    await initToday();
    loadDayView();
    loadSpecies();

    // Auto-refresh every 30 seconds. Only the "today" view can change, so
    // don't bother re-fetching a past day the user is browsing.
    setInterval(() => {
        const activeTab = document.querySelector('.tab-button.active').getAttribute('data-tab');
        if (activeTab === 'recent') {
            if (currentViewedDate === serverTodayDate) {
                loadDayView();
            }
        } else {
            loadSpecies();
        }
    }, 30000);
}

// Run on page load
document.addEventListener('DOMContentLoaded', init);
