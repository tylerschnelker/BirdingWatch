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

// Render a single detection card
function renderDetectionCard(detection) {
    const card = document.createElement('div');
    card.className = 'detection-card';
    card.dataset.id = detection.id;
    
    const confidencePercent = Math.round(detection.confidence * 100);
    const formattedFirstDate = formatDate(detection.first_detected_at);
    const formattedLastDate = formatDate(detection.last_detected_at);
    const durationMinutes = calculateDurationMinutes(detection.first_detected_at, detection.last_detected_at);
    const durationText = formatDuration(durationMinutes);
    
    // Build time info based on duration
    let timeInfo = '';
    if (durationMinutes <= 1) {
        timeInfo = `<div class="detection-time"><span>🕐</span><span>${formattedLastDate}</span></div>`;
    } else {
        timeInfo = `
            <div class="detection-time">
                <span>🕐</span>
                <span>First: ${formattedFirstDate}, Last: ${formattedLastDate}</span>
            </div>
            <div class="detection-duration">
                <span>⏱️</span>
                <span>${durationText}</span>
            </div>
        `;
    }
    
    card.innerHTML = `
        <div class="card-header">
            ${createBirdImage(detection.image_url, 'large').outerHTML}
            <div class="bird-info">
                <div class="bird-name">${detection.species_common}</div>
                <div class="bird-scientific">${detection.species_scientific}</div>
                <span class="confidence-badge">Best confidence: ${confidencePercent}%</span>
                <span class="detection-count-badge">🎵 ${detection.detection_count} call${detection.detection_count !== 1 ? 's' : ''} detected</span>
            </div>
        </div>
        <div class="card-meta">
            ${timeInfo}
        </div>
        ${detection.wiki_summary ? `
            <div class="wiki-summary collapsed" id="summary-${detection.id}">
                ${detection.wiki_summary}
            </div>
            <button class="expand-button" onclick="toggleSummary(${detection.id})">Read more</button>
        ` : ''}
        <div class="audio-player-container">
            <audio controls src="/api/audio/${detection.audio_filename}"></audio>
            <button class="delete-button" onclick="deleteDetection(${detection.id})" title="Delete detection">🗑️</button>
        </div>
    `;
    
    return card;
}

// Toggle wiki summary expansion
function toggleSummary(id) {
    const summary = document.getElementById(`summary-${id}`);
    const button = summary.nextElementSibling;
    
    if (summary.classList.contains('collapsed')) {
        summary.classList.remove('collapsed');
        button.textContent = 'Show less';
    } else {
        summary.classList.add('collapsed');
        button.textContent = 'Read more';
    }
}

// Delete a detection
async function deleteDetection(detectionId) {
    if (!confirm('Are you sure you want to delete this detection?')) {
        return;
    }
    
    try {
        const response = await fetch(`/api/detections/${detectionId}`, {
            method: 'DELETE'
        });
        
        if (response.ok) {
            // Remove the card from the DOM
            const card = document.querySelector(`.detection-card[data-id="${detectionId}"]`);
            if (card) {
                card.style.opacity = '0';
                card.style.transform = 'scale(0.9)';
                setTimeout(() => card.remove(), 300);
            }
            // Refresh the species list if it's visible
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

// Fetch and render detections
async function loadDetections() {
    const container = document.getElementById('detections-container');
    
    try {
        const response = await fetch('/api/detections?limit=50');
        const detections = await response.json();
        
        container.innerHTML = '';
        
        if (detections.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">🐦</div>
                    <div class="empty-state-text">No detections yet</div>
                    <div class="empty-state-subtext">Bird calls will appear here once detected</div>
                </div>
            `;
            return;
        }
        
        detections.forEach(detection => {
            container.appendChild(renderDetectionCard(detection));
        });
    } catch (error) {
        console.error('Error loading detections:', error);
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-text">Error loading detections</div>
                <div class="empty-state-subtext">Please refresh the page</div>
            </div>
        `;
    }
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
function init() {
    setupTabs();
    loadDetections();
    loadSpecies();
    
    // Auto-refresh every 30 seconds
    setInterval(() => {
        const activeTab = document.querySelector('.tab-button.active').getAttribute('data-tab');
        if (activeTab === 'recent') {
            loadDetections();
        } else {
            loadSpecies();
        }
    }, 30000);
}

// Run on page load
document.addEventListener('DOMContentLoaded', init);
