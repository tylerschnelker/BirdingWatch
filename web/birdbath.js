// Birdbath home tab: the day's birds take turns at a birdbath. Swiping moves
// through the day (earlier to the left), each bird ordered by when it was last
// heard, and the sky follows that time. Birds wait on the fence on either side
// and hop onto the rim when they reach the middle.

const BATH_TZ = 'America/Denver';
// Deliberately coarse (Denver area): only used to colour the sky.
const BATH_LAT = 39.7;
const BATH_LON = -105.0;

// Scene drawing units; the SVG is scaled to cover the scene, anchored at the bottom.
const BATH_GRID = { w: 400, h: 380, perch: 191, rim: 245, horizon: 186 };
const BATH_SLOT = 0.36;  // one bird's slot, as a share of the scene width

const SKY_STOPS = [
    // [sun altitude in degrees, top colour, horizon colour]
    [-18, '#070b1d', '#121a3a'],
    [-10, '#0f1638', '#262d5e'],
    [-5, '#24336e', '#8a5a86'],
    [-1, '#3e5fa6', '#ec8a62'],
    [4, '#5f8fd0', '#f5c486'],
    [10, '#64a3df', '#cfe3ee'],
    [30, '#4a90da', '#bcdcf3'],
];

const STARS = [[8, 9], [17, 22], [26, 6], [34, 17], [45, 8], [53, 25], [61, 12], [70, 4], [77, 20], [88, 10], [93, 28], [12, 33], [40, 30], [66, 34]];

const bath = {
    birds: [], date: null, isToday: false, signature: '',
    current: -1, target: 0, layout: null, framePending: false, audio: null,
};

const bathTimeFormat = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: BATH_TZ });
const bathHourFormat = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: 'numeric', hourCycle: 'h23', timeZone: BATH_TZ });

function bathTime(ts) {
    return bathTimeFormat.format(new Date(ts * 1000));
}

// Fractional local hour (e.g. 15.5 for 3:30 PM) at the backyard
function bathHour(ts) {
    const parts = bathHourFormat.formatToParts(new Date(ts * 1000));
    const get = type => Number(parts.find(p => p.type === type).value);
    return (get('hour') % 24) + get('minute') / 60;
}

// Sun altitude in degrees (low-precision solar position, plenty for sky colour)
function sunAltitude(ts) {
    const rad = Math.PI / 180;
    const d = ts / 86400 - 10957.5;  // days since J2000.0
    const g = (357.529 + 0.98560028 * d) * rad;
    const q = 280.459 + 0.98564736 * d;
    const lambda = (q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * rad;
    const e = (23.439 - 0.00000036 * d) * rad;
    const ra = Math.atan2(Math.cos(e) * Math.sin(lambda), Math.cos(lambda));
    const dec = Math.asin(Math.sin(e) * Math.sin(lambda));
    const gmst = (18.697374558 + 24.06570982441908 * d) % 24;
    const hourAngle = (gmst * 15 + BATH_LON) * rad - ra;
    const lat = BATH_LAT * rad;
    return Math.asin(Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(hourAngle)) / rad;
}

function mixHex(a, b, t) {
    const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
    const ch = shift => Math.round(((pa >> shift) & 255) * (1 - t) + ((pb >> shift) & 255) * t);
    return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`;
}

function skyColors(alt) {
    if (alt <= SKY_STOPS[0][0]) return [SKY_STOPS[0][1], SKY_STOPS[0][2]];
    for (let i = 1; i < SKY_STOPS.length; i++) {
        const [a1, top1, bottom1] = SKY_STOPS[i];
        if (alt <= a1) {
            const [a0, top0, bottom0] = SKY_STOPS[i - 1];
            const t = (alt - a0) / (a1 - a0);
            return [mixHex(top0, top1, t), mixHex(bottom0, bottom1, t)];
        }
    }
    const last = SKY_STOPS[SKY_STOPS.length - 1];
    return [last[1], last[2]];
}

// The landscape and the bath, in BATH_GRID units. Grass and snow follow the season.
function bathLandscapeSvg(dateStr) {
    const month = Number(dateStr.slice(5, 7));
    const dormant = month >= 11 || month <= 3;
    const snowy = month >= 10 || month <= 5;
    const grassTop = dormant ? '#a9a66f' : '#7fae57';
    const grassBottom = dormant ? '#8c8a55' : '#5f9142';

    const peaks = [[0, 172], [28, 152], [52, 162], [80, 128], [104, 148], [130, 120], [152, 140], [178, 114], [202, 136], [228, 122], [252, 144], [278, 110], [302, 132], [328, 124], [354, 148], [380, 128], [400, 140]];
    const ridge = `M0,210 L${peaks.map(p => p.join(',')).join(' L')} L400,210 Z`;
    const snow = snowy
        ? peaks.filter(([, y]) => y < 132).map(([x, y]) =>
            `M${x - 9},${y + 10} L${x},${y} L${x + 9},${y + 11} L${x + 4},${y + 8} L${x},${y + 12} L${x - 4},${y + 8} Z`).join(' ')
        : '';

    let boards = '';
    for (let x = -4; x < 404; x += 19) {
        boards += `<rect x="${x}" y="${BATH_GRID.perch + 2}" width="17.5" height="48" rx="1"/>`;
    }

    const pine = (x, y, s) => `<path d="M${x},${y - 60 * s} L${x - 16 * s},${y - 22 * s} L${x - 7 * s},${y - 24 * s} L${x - 22 * s},${y} L${x + 22 * s},${y} L${x + 7 * s},${y - 24 * s} L${x + 16 * s},${y - 22 * s} Z"/>`;

    return `
    <svg class="bath-land" viewBox="0 0 ${BATH_GRID.w} ${BATH_GRID.h}" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
        <defs>
            <linearGradient id="bath-grass" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stop-color="${grassTop}"/><stop offset="1" stop-color="${grassBottom}"/>
            </linearGradient>
            <linearGradient id="bath-stone" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stop-color="#8f897f"/><stop offset="0.45" stop-color="#c9c2b6"/><stop offset="1" stop-color="#8a847a"/>
            </linearGradient>
            <linearGradient id="bath-far" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stop-color="#8d9fbb"/><stop offset="1" stop-color="#a7b5c8"/>
            </linearGradient>
        </defs>
        <path d="${ridge}" fill="url(#bath-far)"/>
        <path d="${snow}" fill="#f4f6fa" opacity="0.9"/>
        <path d="M0,206 C40,180 92,188 132,192 C172,196 214,178 262,184 C312,190 352,178 400,188 L400,230 L0,230 Z" fill="#6c7f63"/>
        <g fill="#3f5a45">${pine(30, 200, 1)}${pine(58, 200, 0.75)}${pine(352, 200, 1.1)}${pine(381, 200, 0.7)}</g>
        <g fill="#b48b62" stroke="#94704d" stroke-width="1">${boards}</g>
        <rect x="-4" y="${BATH_GRID.perch - 2}" width="408" height="5" rx="1.5" fill="#8f6a48"/>
        <rect x="0" y="238" width="400" height="142" fill="url(#bath-grass)"/>
        <g fill="#4f7a45" opacity="0.85">
            <ellipse cx="20" cy="240" rx="34" ry="14"/><ellipse cx="62" cy="242" rx="24" ry="10"/>
            <ellipse cx="382" cy="240" rx="36" ry="15"/><ellipse cx="340" cy="243" rx="20" ry="9"/>
        </g>
        <ellipse cx="200" cy="356" rx="74" ry="9" fill="rgba(0,0,0,0.16)"/>
        <path d="M170,354 L230,354 L221,337 L179,337 Z" fill="url(#bath-stone)"/>
        <ellipse cx="200" cy="337" rx="21" ry="4" fill="#b7b0a4"/>
        <path d="M187,337 C191,314 193,293 190,276 L210,276 C207,293 209,314 213,337 Z" fill="url(#bath-stone)"/>
        <path d="M107,${BATH_GRID.rim + 4} C117,${BATH_GRID.rim + 30} 160,${BATH_GRID.rim + 37} 200,${BATH_GRID.rim + 37} C240,${BATH_GRID.rim + 37} 283,${BATH_GRID.rim + 30} 293,${BATH_GRID.rim + 4} Z" fill="url(#bath-stone)"/>
        <ellipse cx="200" cy="${BATH_GRID.rim + 4}" rx="93" ry="14" fill="#cdc6ba"/>
        <ellipse cx="200" cy="${BATH_GRID.rim + 5}" rx="83" ry="10" class="bath-water"/>
        <ellipse cx="176" cy="${BATH_GRID.rim + 2}" rx="26" ry="2.5" fill="#ffffff" opacity="0.28"/>
        <g class="bath-ripples" fill="none" stroke="#ffffff" stroke-width="1.2">
            <ellipse cx="200" cy="${BATH_GRID.rim + 6}" rx="22" ry="3.2"/>
            <ellipse cx="200" cy="${BATH_GRID.rim + 6}" rx="22" ry="3.2"/>
        </g>
    </svg>`;
}

// The day's iNaturalist photo in a round frame; the drawing (birds.js) only
// when there's no photo or it fails to load.
function bathBirdArt(item) {
    if (!item.image_url || item.photo_failed) {
        return `<div class="bath-bird drawn">${birdSvg(item.species_common)}</div>`;
    }
    // Cards use iNaturalist's 500px "medium"; the 240px "small" is soft on a phone.
    const src = item.image_url.replace(/\/small\.(jpe?g|png)$/, '/medium.$1');
    return `
        <div class="bath-bird medallion${item.is_first_ever ? ' first-ever' : ''}">
            <div class="medallion-ring"><img src="${escapeHtml(src)}" alt=""></div>
            <div class="medallion-feet"><i></i><i></i></div>
        </div>`;
}

function renderBirdbath(data, dateStr, isToday) {
    const scene = document.getElementById('bath-scene');
    if (!scene) return;

    const birds = (data.species || []).slice().sort((a, b) => a.last_seen_timestamp - b.last_seen_timestamp);
    const signature = [dateStr, ...birds.map(b =>
        `${b.species_common}:${b.last_seen_timestamp}:${b.visit_count}:${b.image_url}`)].join('|');
    if (signature === bath.signature) {
        updateBathInfo(true);
        return;
    }

    // On a refresh of the same day, stay with the bird being looked at, unless
    // it was the latest one: then follow along to the new latest bird.
    const sameDay = bath.date === dateStr;
    const lookingAt = sameDay ? bath.birds[bath.current] : null;
    const wasAtEnd = sameDay && bath.current === bath.birds.length - 1;

    Object.assign(bath, { birds, date: dateStr, isToday, signature, current: -1 });
    stopBathAudio();

    document.getElementById('bath-landscape').innerHTML = bathLandscapeSvg(dateStr);
    document.getElementById('bath-empty').hidden = birds.length > 0;
    document.getElementById('bath-empty').textContent = isToday ? 'No birds at the bath yet today' : 'No birds heard this day';
    document.getElementById('bath-info').hidden = birds.length === 0;

    const track = document.getElementById('bath-track');
    track.innerHTML = '<div class="bath-spacer"></div>' + birds.map((item, i) => `
        <div class="bath-slot" data-index="${i}">
            <button class="bath-bird-button" aria-label="${escapeHtml(item.species_common)}">${bathBirdArt(item)}</button>
        </div>`).join('') + '<div class="bath-spacer"></div>';
    track.querySelectorAll('.bath-slot').forEach(slot => {
        const i = Number(slot.dataset.index);
        slot.querySelector('button').addEventListener('click', () => {
            if (i === bath.current) openBirdSheet(bath.birds[i]);
            else scrollBathTo(i, true);
        });
        // A photo that fails to load falls back to the drawing.
        const img = slot.querySelector('img');
        if (img) img.addEventListener('error', () => {
            birds[i].photo_failed = true;
            slot.querySelector('.bath-bird').outerHTML = bathBirdArt(birds[i]);
            updateBathFrame();
            if (i === bath.current) updateBathInfo(false);
        }, { once: true });
    });

    let start = isToday ? birds.length - 1 : 0;
    if (lookingAt && !wasAtEnd) {
        const i = birds.findIndex(b => b.species_common === lookingAt.species_common);
        if (i >= 0) start = i;
    }
    bath.target = Math.max(0, start);

    buildBathTimeline();
    layoutBath();
}

// Size everything from the scene's current box. Called on render, resize, and
// when the tab becomes visible (a hidden tab measures 0 wide).
function layoutBath() {
    const scene = document.getElementById('bath-scene');
    const track = document.getElementById('bath-track');
    const w = scene.clientWidth, h = scene.clientHeight;
    if (!w || !h) return;

    const scale = Math.max(w / BATH_GRID.w, h / BATH_GRID.h);
    const offsetY = h - BATH_GRID.h * scale;
    const slotWidth = Math.round(w * BATH_SLOT);
    bath.layout = {
        w, h, scale, slotWidth,
        perch: offsetY + BATH_GRID.perch * scale,
        rim: offsetY + BATH_GRID.rim * scale,
        horizon: offsetY + BATH_GRID.horizon * scale,
    };

    scene.style.setProperty('--bird-k', Math.min(scale, 1.35));
    scene.style.setProperty('--perch-bottom', `${h - bath.layout.perch}px`);
    track.querySelectorAll('.bath-slot').forEach(slot => { slot.style.width = `${slotWidth}px`; });
    track.querySelectorAll('.bath-spacer').forEach(sp => { sp.style.width = `${(w - slotWidth) / 2}px`; });

    track.scrollLeft = bath.target * slotWidth;
    bath.current = -1;
    updateBathFrame();
}

function scrollBathTo(index, smooth) {
    const track = document.getElementById('bath-track');
    if (!bath.layout) return;
    bath.target = index;
    track.scrollTo({ left: index * bath.layout.slotWidth, behavior: smooth ? 'smooth' : 'auto' });
}

function scheduleBathFrame() {
    if (bath.framePending) return;
    bath.framePending = true;
    requestAnimationFrame(() => {
        bath.framePending = false;
        updateBathFrame();
    });
}

// Position every bird for the current scroll, and set the sky to match.
function updateBathFrame() {
    const L = bath.layout;
    const scene = document.getElementById('bath-scene');
    const track = document.getElementById('bath-track');
    if (!L) return;

    const n = bath.birds.length;
    const f = n ? Math.min(Math.max(track.scrollLeft / L.slotWidth, 0), n - 1) : 0;
    const hopTo = L.perch - L.rim;  // negative: the rim is lower than the fence

    track.querySelectorAll('.bath-slot').forEach(slot => {
        const i = Number(slot.dataset.index);
        const d = i - f;
        const t = Math.max(0, 1 - Math.abs(d));       // 1 = on the bath
        const scale = 0.52 + 0.48 * t;
        const lift = -hopTo * t - 26 * Math.sin(Math.PI * t) * (L.scale);
        const bird = slot.querySelector('.bath-bird');
        if (!bird) return;
        // Drawn birds face the bath; the one on the rim keeps the way it came in.
        if (d > 0.5) slot.dataset.face = 'left';
        else if (d < -0.5) slot.dataset.face = 'right';
        const flip = bird.classList.contains('drawn') && slot.dataset.face === 'left' ? -1 : 1;
        bird.style.transform = `translateX(-50%) translateY(${lift.toFixed(1)}px) scale(${(scale * flip).toFixed(3)}, ${scale.toFixed(3)})`;
        bird.style.opacity = Math.abs(d) > 2.2 ? 0 : 1;
        slot.classList.toggle('at-bath', Math.abs(d) < 0.08);
    });

    // Time at this scroll position: between the two nearest birds.
    let ts;
    if (n) {
        const i0 = Math.floor(f), i1 = Math.min(i0 + 1, n - 1);
        const a = bath.birds[i0].last_seen_timestamp, b = bath.birds[i1].last_seen_timestamp;
        ts = a + (b - a) * (f - i0);
    } else if (bath.isToday || !bath.date) {
        ts = Date.now() / 1000;
    } else {
        ts = new Date(`${bath.date}T12:00:00-07:00`).getTime() / 1000;
    }
    setBathSky(ts);

    const current = n ? Math.round(f) : -1;
    scene.classList.toggle('bird-at-bath', n > 0 && Math.abs(f - current) < 0.08);
    document.getElementById('bath-prev').hidden = !n || f < 0.5;
    document.getElementById('bath-next').hidden = !n || f > n - 1.5;
    moveTimelineCursor(ts);

    if (current !== bath.current) {
        bath.current = current;
        bath.target = Math.max(current, 0);
        stopBathAudio();
        updateBathInfo(false);
        highlightTimeline();
    }
}

function setBathSky(ts) {
    const L = bath.layout;
    const scene = document.getElementById('bath-scene');
    const alt = sunAltitude(ts);
    const [top, bottom] = skyColors(alt);
    const night = Math.min(Math.max((2 - alt) / 10, 0), 1);

    scene.style.setProperty('--sky-top', top);
    scene.style.setProperty('--sky-bottom', bottom);
    scene.style.setProperty('--night', night.toFixed(3));
    scene.style.setProperty('--water', mixHex('#6f9bbd', '#1b2547', night));

    // The sun crosses left to right over the day and sets behind the mountains.
    const hour = bathHour(ts);
    const sun = document.getElementById('bath-sun');
    const x = 8 + Math.min(Math.max((hour - 6) / 12, 0), 1) * 84;
    const y = Math.max(L.horizon - Math.max(alt, -8) / 60 * L.horizon * 0.95, 34);
    sun.style.left = `${x}%`;
    sun.style.top = `${y}px`;
    sun.style.opacity = alt > -3 ? 1 : 0;
    document.getElementById('bath-moon').style.opacity = night > 0.6 ? (night - 0.6) / 0.4 : 0;
    document.getElementById('bath-stars').style.opacity = night;

    const clock = document.getElementById('bath-clock-time');
    clock.textContent = bath.birds.length ? bathTime(ts) : '';
}

function buildBathTimeline() {
    const visits = bath.birds.flatMap((item, i) => (item.visits || []).map(([start, end]) => ({ i, start, end })));
    const hours = visits.flatMap(v => [bathHour(v.start), bathHour(v.end)]);
    const h0 = Math.min(6, Math.floor(Math.min(...hours, 24)));
    const h1 = Math.max(19, Math.ceil(Math.max(...hours, 0)));
    bath.timeline = { h0, h1, visits };

    const pos = hour => ((hour - h0) / (h1 - h0)) * 100;
    const bar = document.getElementById('bath-timeline-bar');
    bar.innerHTML = visits.map(v => {
        const left = pos(bathHour(v.start));
        const width = Math.max(pos(bathHour(v.end)) - left, 0);
        return `<i data-index="${v.i}" style="left:${left.toFixed(2)}%;width:calc(${width.toFixed(2)}% + 6px)"></i>`;
    }).join('') + '<b id="bath-timeline-cursor"></b>';

    const labels = [];
    for (let hr = Math.ceil(h0 / 3) * 3; hr <= h1; hr += 3) {
        const label = hr === 0 || hr === 24 ? '12a' : hr === 12 ? '12p' : hr < 12 ? `${hr}a` : `${hr - 12}p`;
        labels.push(`<span style="left:${pos(hr).toFixed(2)}%">${label}</span>`);
    }
    document.getElementById('bath-timeline-labels').innerHTML = labels.join('');
    document.getElementById('bath-timeline').hidden = visits.length === 0;
}

function moveTimelineCursor(ts) {
    const cursor = document.getElementById('bath-timeline-cursor');
    if (!cursor || !bath.timeline) return;
    const { h0, h1 } = bath.timeline;
    cursor.style.left = `${((bathHour(ts) - h0) / (h1 - h0)) * 100}%`;
}

function highlightTimeline() {
    document.querySelectorAll('#bath-timeline-bar i').forEach(dot => {
        dot.classList.toggle('current', Number(dot.dataset.index) === bath.current);
    });
}

// Tap the timeline to jump to the bird with the nearest visit.
function onTimelineTap(event) {
    if (!bath.timeline || !bath.timeline.visits.length) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const { h0, h1, visits } = bath.timeline;
    const hour = h0 + ((event.clientX - rect.left) / rect.width) * (h1 - h0);
    let best = visits[0];
    visits.forEach(v => {
        if (Math.abs(bathHour(v.start) - hour) < Math.abs(bathHour(best.start) - hour)) best = v;
    });
    scrollBathTo(best.i, true);
}

function formatHeardAgo(ts) {
    const minutes = Math.round((Date.now() / 1000 - ts) / 60);
    if (minutes < 2) return 'Heard just now';
    if (minutes < 60) return `Last heard ${minutes} min ago`;
    return `Last heard ${bathTime(ts)}`;
}

function updateBathInfo(refreshOnly) {
    const item = bath.birds[bath.current];
    if (!item) return;
    const sub = document.getElementById('bath-sub');
    const heard = bath.isToday ? formatHeardAgo(item.last_seen_timestamp) : `Last heard ${bathTime(item.last_seen_timestamp)}`;
    sub.textContent = `${heard} · ${item.visit_count} visit${item.visit_count !== 1 ? 's' : ''}`;
    if (refreshOnly) return;

    document.getElementById('bath-name').textContent = item.species_common;
    document.getElementById('bath-first-ever').hidden = !item.is_first_ever;
    const backyard = formatBackyardLine(item);
    document.getElementById('bath-backyard').textContent = backyard ? `🏡 ${backyard}` : '';
    document.getElementById('bath-credit').innerHTML = item.photo_failed ? '' : renderPhotoCredit(item.photo_credit);

    const play = document.getElementById('bath-play');
    play.disabled = !item.audio_filename;
    play.classList.remove('playing');
    play.setAttribute('aria-label', item.audio_filename ? 'Play call' : 'No recording kept');
}

function toggleBathAudio() {
    const item = bath.birds[bath.current];
    if (!item || !item.audio_filename) return;
    if (bath.audio) {
        stopBathAudio();
        return;
    }
    const audio = new Audio(`/api/audio/${encodeURIComponent(item.audio_filename)}`);
    bath.audio = audio;
    const slot = document.querySelector(`.bath-slot[data-index="${bath.current}"]`);
    audio.addEventListener('ended', stopBathAudio);
    audio.addEventListener('error', stopBathAudio);
    audio.play().then(() => {
        document.getElementById('bath-play').classList.add('playing');
        if (slot) slot.classList.add('singing');
    }).catch(stopBathAudio);
}

function stopBathAudio() {
    if (bath.audio) {
        bath.audio.pause();
        bath.audio = null;
    }
    document.getElementById('bath-play')?.classList.remove('playing');
    document.querySelectorAll('.bath-slot.singing').forEach(s => s.classList.remove('singing'));
}

// The full card (photo, credit, description, call, visits) in a sheet from the bottom.
function openBirdSheet(item) {
    stopBathAudio();
    const backdrop = document.createElement('div');
    backdrop.className = 'sheet-backdrop';
    backdrop.innerHTML = '<div class="sheet" role="dialog" aria-modal="true"><button class="sheet-close" aria-label="Close">✕</button></div>';
    const sheet = backdrop.querySelector('.sheet');
    sheet.appendChild(renderSpeciesDayCard(item, bath.date));
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
}

function setupBirdbath() {
    const scene = document.getElementById('bath-scene');
    if (!scene) return;
    const stars = document.getElementById('bath-stars');
    stars.innerHTML = STARS.map(([x, y]) => `<i style="left:${x}%;top:${y}%"></i>`).join('');

    document.getElementById('bath-track').addEventListener('scroll', scheduleBathFrame, { passive: true });
    document.getElementById('bath-prev').addEventListener('click', () => scrollBathTo(Math.max(bath.current - 1, 0), true));
    document.getElementById('bath-next').addEventListener('click', () => scrollBathTo(Math.min(bath.current + 1, bath.birds.length - 1), true));
    document.getElementById('bath-play').addEventListener('click', toggleBathAudio);
    document.getElementById('bath-more').addEventListener('click', () => {
        const item = bath.birds[bath.current];
        if (item) openBirdSheet(item);
    });
    document.getElementById('bath-timeline-bar').addEventListener('click', onTimelineTap);
    new ResizeObserver(() => layoutBath()).observe(scene);
}
