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

// Create bird image element with fallback to silhouette
function createBirdImage(imageUrl, size = 'large') {
    const img = document.createElement('div');
    const width = size === 'large' ? 80 : 60;
    const height = size === 'large' ? 80 : 60;
    
    img.style.width = `${width}px`;
    img.style.height = `${height}px`;
    img.className = size === 'large' ? 'bird-photo' : 'species-thumbnail';
    
    if (imageUrl) {
        img.innerHTML = `<img src="${imageUrl}" alt="Bird" style="width:100%;height:100%;object-fit:cover;border-radius:8px;" onerror="this.parentElement.innerHTML='${BIRD_SILHOUETT}'">`;
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
    
    const confidencePercent = Math.round(detection.confidence * 100);
    const formattedDate = formatDate(detection.detected_at);
    
    card.innerHTML = `
        <div class="card-header">
            ${createBirdImage(detection.image_url, 'large').outerHTML}
            <div class="bird-info">
                <div class="bird-name">${detection.species_common}</div>
                <div class="bird-scientific">${detection.species_scientific}</div>
                <span class="confidence-badge">${confidencePercent}% confidence</span>
            </div>
        </div>
        <div class="card-meta">
            <div class="detection-time">
                <span>🕐</span>
                <span>${formattedDate}</span>
            </div>
        </div>
        ${detection.wiki_summary ? `
            <div class="wiki-summary collapsed" id="summary-${detection.id}">
                ${detection.wiki_summary}
            </div>
            <button class="expand-button" onclick="toggleSummary(${detection.id})">Read more</button>
        ` : ''}
        <div class="audio-player">
            <audio controls src="/api/audio/${detection.audio_filename}"></audio>
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

// Render species list item
function renderSpeciesItem(species) {
    const item = document.createElement('div');
    item.className = 'species-item';
    
    const lastSeen = formatDate(species.last_seen);
    
    item.innerHTML = `
        ${createBirdImage(species.image_url, 'small').outerHTML}
        <div class="species-details">
            <div class="species-name">${species.species_common}</div>
            <div class="species-stats">
                <div class="stat-item">
                    <span>🔢</span>
                    <span class="visit-count">${species.count}</span>
                    <span>visit${species.count !== 1 ? 's' : ''}</span>
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
