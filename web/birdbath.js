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
    weather: null, weatherDate: null, weatherFetched: 0,
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

function colorChannels(c) {
    if (c[0] === '#') {
        const n = parseInt(c.slice(1), 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    return c.match(/\d+/g).map(Number);
}

// Mix two colours (#hex or rgb()) t of the way from a to b
function mixHex(a, b, t) {
    const pa = colorChannels(a), pb = colorChannels(b);
    const ch = i => Math.round(pa[i] * (1 - t) + pb[i] * t);
    return `rgb(${ch(0)}, ${ch(1)}, ${ch(2)})`;
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

// The garden's plants, each drawn around its base at (0, 0), growing up (-y).
const LEAF = '#5e8a46';
const LEAF_DARK = '#466f37';
const STRAW = '#6b5640';

function plantStem(dx, h, color = LEAF) {
    return `<path d="M0,0 Q${(dx * 0.25).toFixed(1)},${(-h * 0.55).toFixed(1)} ${dx},${-h}" stroke="${color}" stroke-width="1.3" fill="none" stroke-linecap="round"/>`;
}

function plantLeaves(color = LEAF) {
    return `<path d="M0,0 C-9,-3 -12,-8 -13,-11 C-7,-10 -3,-6 0,0 Z M0,0 C8,-2 11,-7 12,-10 C6,-9 2,-5 0,0 Z" fill="${color}"/>`;
}

function ring(count, radius, rx, ry, color, start = 0, span = 360) {
    let out = '';
    for (let i = 0; i < count; i++) {
        const a = start + (span * i) / (span === 360 ? count : count - 1);
        const rad = a * Math.PI / 180;
        const x = (Math.cos(rad) * radius).toFixed(1), y = (Math.sin(rad) * radius).toFixed(1);
        out += `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" transform="rotate(${a.toFixed(0)} ${x} ${y})" fill="${color}"/>`;
    }
    return out;
}

const PLANTS = {
    coneflower: () => plantLeaves() + [[-7, 26], [2, 33], [9, 22]].map(([dx, h]) =>
        plantStem(dx, h) + `<g transform="translate(${dx} ${-h})">${ring(7, 4.2, 4.4, 1.5, '#c86fa8', 5, 170)}<ellipse cy="-1" rx="2.8" ry="3.1" fill="#8a4a1c"/></g>`).join(''),
    susan: () => plantLeaves() + [[-6, 20], [4, 26], [10, 17]].map(([dx, h]) =>
        plantStem(dx, h) + `<g transform="translate(${dx} ${-h})">${ring(10, 3.8, 3.6, 1.4, '#f2b01e')}<circle r="2.3" fill="#3a2414"/></g>`).join(''),
    lavender: () => [-2, -1, 0, 1, 2].map(i => {
        const dx = i * 4.5, h = 22 + (2 - Math.abs(i)) * 4;
        let buds = '';
        for (let k = 0; k < 6; k++) buds += `<circle cx="${(dx * (1 - k * 0.04)).toFixed(1)}" cy="${(-h + k * 2.2).toFixed(1)}" r="${(1.9 - k * 0.12).toFixed(2)}" fill="#8b78c9"/>`;
        return plantStem(dx, h, '#7f9a6c') + buds;
    }).join(''),
    tulip: color => `<path d="M0,0 C-6,-6 -8,-14 -6,-20 C-3,-12 -1,-6 0,0 Z M0,0 C6,-5 8,-12 7,-18 C4,-11 1,-6 0,0 Z" fill="${LEAF}"/>` +
        [[-5, 23], [3, 28], [9, 21]].map(([dx, h]) => plantStem(dx, h) +
            `<path transform="translate(${dx} ${-h})" d="M-3.6,0 C-4.4,-5 -3.4,-8 -1.8,-8.4 L0,-6 L1.8,-8.4 C3.4,-8 4.4,-5 3.6,0 C2,1.6 -2,1.6 -3.6,0 Z" fill="${color}"/>`).join(''),
    daffodil: () => plantLeaves() + [[-5, 22], [5, 26], [0, 17]].map(([dx, h]) => plantStem(dx, h) +
        `<g transform="translate(${dx} ${-h})">${ring(6, 3, 3.2, 1.8, '#fbe58e')}<circle r="2.2" fill="#f4a522"/></g>`).join(''),
    crocus: () => [[-7, 7, '#9b7fd1'], [0, 9, '#f1ecf7'], [6, 7, '#9b7fd1'], [12, 5, '#b49be0']].map(([dx, h, c]) =>
        `<path d="M${dx},0 L${dx},${-h}" stroke="${LEAF}" stroke-width="1"/><path transform="translate(${dx} ${-h})" d="M-2.2,0 C-2.6,-3.5 -1,-5.5 0,-5.5 C1,-5.5 2.6,-3.5 2.2,0 Z" fill="${c}"/>`).join(''),
    aster: () => {
        let dots = '';
        for (let i = 0; i < 16; i++) {
            const x = Math.sin(i * 2.4) * 11 * (0.4 + (i % 4) / 6), y = -10 - Math.cos(i * 1.7) * 6 - (i % 3);
            dots += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.3" fill="#a48bd8"/><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="0.8" fill="#f5c542"/>`;
        }
        return `<ellipse cy="-9" rx="14" ry="10" fill="${LEAF_DARK}"/>` + dots;
    },
    mum: color => {
        // Small blooms packed over a dome
        let dots = '';
        for (let row = 0; row < 4; row++) {
            const y = -4 - row * 4.2, half = 13.5 * Math.sqrt(1 - (row / 4.4) ** 2);
            for (let x = -half + (row % 2) * 1.8; x <= half; x += 3.8) {
                const jx = x + Math.sin(x * 3 + row) * 0.6, jy = y + Math.cos(x * 2 + row) * 0.7;
                dots += `<circle cx="${jx.toFixed(1)}" cy="${jy.toFixed(1)}" r="2.4" fill="${color}"/><circle cx="${jx.toFixed(1)}" cy="${jy.toFixed(1)}" r="0.7" fill="#5a2a12" opacity="0.5"/>`;
            }
        }
        return `<ellipse cy="-7" rx="15" ry="9" fill="${LEAF_DARK}"/>` + dots;
    },
    grass: (color, plumes) => [-12, -8, -4, -1, 2, 5, 9, 13].map((dx, i) => {
        const h = 26 - Math.abs(dx) * 0.9 + (i % 2) * 3;
        return `<path d="M0,0 Q${(dx * 0.2).toFixed(1)},${(-h * 0.7).toFixed(1)} ${dx},${(-h).toFixed(1)}" stroke="${color}" stroke-width="1.5" fill="none" stroke-linecap="round"/>` +
            (plumes && i % 2 ? `<ellipse cx="${dx}" cy="${(-h - 3).toFixed(1)}" rx="1.9" ry="4.5" transform="rotate(${dx * 3} ${dx} ${(-h - 3).toFixed(1)})" fill="#e8d6a6"/>` : '');
    }).join(''),
    seedheads: () => [[-8, 20], [-2, 27], [4, 23], [10, 18]].map(([dx, h]) =>
        plantStem(dx, h, STRAW) + `<circle cx="${dx}" cy="${-h}" r="2.5" fill="#3d2b1f"/>`).join(''),
    shrub: (color, snow, berries) => {
        let out = `<ellipse cy="-12" rx="16" ry="13" fill="${color}"/><ellipse cx="-5" cy="-17" rx="8" ry="5" fill="#ffffff" opacity="0.1"/>`;
        if (berries) {
            for (let i = 0; i < 9; i++) out += `<circle cx="${(Math.sin(i * 2.1) * 11).toFixed(1)}" cy="${(-12 + Math.cos(i * 1.3) * 7).toFixed(1)}" r="1.5" fill="#c43a2f"/>`;
        }
        if (snow) out += '<path d="M-14,-17 C-11,-27 11,-27 14,-17 C9,-20 4,-18 0,-20 C-5,-18 -9,-20 -14,-17 Z" fill="#f4f6fa"/>';
        return out;
    },
};

// What grows in each bed by month: [back border mix, front bed mix].
function gardenSeason(month) {
    const P = PLANTS;
    const green = () => P.grass('#7f9f5a', false);
    const straw = () => P.grass('#c8a96b', true);
    const box = (snow, berries) => () => P.shrub(snow ? '#3f5f3a' : '#43703f', snow, berries);
    if (month === 12 || month <= 2) {
        return [[box(true), P.seedheads, straw, box(true, true), P.seedheads, straw],
            [box(true, true), straw, P.seedheads, box(true), straw, P.seedheads]];
    }
    if (month === 3) {
        return [[P.crocus, box(), straw, P.crocus, P.seedheads, box()],
            [P.crocus, box(), P.crocus, straw, box(), P.crocus]];
    }
    if (month <= 5) {
        const red = () => P.tulip('#e5484d'), pink = () => P.tulip('#f28cb1'), yellow = () => P.tulip('#f7c948');
        return [[red, P.daffodil, pink, box(), P.daffodil, yellow, green, red],
            [red, P.daffodil, pink, yellow, box(), red, P.daffodil, pink]];
    }
    if (month <= 8) {
        return [[P.lavender, P.susan, P.coneflower, green, P.coneflower, P.lavender, box(), P.susan],
            [P.coneflower, P.susan, P.lavender, green, P.coneflower, box(), P.susan, P.lavender]];
    }
    const orange = () => P.mum('#e07a2e'), rust = () => P.mum('#b5452b'), gold = () => P.mum('#e8b630');
    if (month <= 10) {
        return [[P.aster, orange, straw, rust, P.aster, box(), gold, straw],
            [orange, P.aster, rust, straw, gold, P.aster, box(), orange]];
    }
    // November: the last mums, grasses gone to seed, berries
    return [[P.seedheads, straw, rust, box(false, true), P.seedheads, box(), straw],
        [rust, straw, box(false, true), P.seedheads, straw, box(), rust]];
}

function plantAt(x, y, scale, draw) {
    return `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${scale.toFixed(2)})">${draw()}</g>`;
}

// The landscape and the bath, in BATH_GRID units. The bath is at x = 200; the
// scenery runs from -400 to 800 so a wide screen shows more yard, not a crop.
// Grass, snow and the garden follow the season.
function bathLandscapeSvg(dateStr) {
    const month = Number(dateStr.slice(5, 7));
    const dormant = month >= 11 || month <= 3;
    const snowy = month >= 10 || month <= 5;
    const grassTop = dormant ? '#a9a66f' : '#7fae57';
    const grassBottom = dormant ? '#8c8a55' : '#5f9142';
    const [backMix, frontMix] = gardenSeason(month);

    const base = [[0, 172], [28, 152], [52, 162], [80, 128], [104, 148], [130, 120], [152, 140], [178, 114], [202, 136], [228, 122], [252, 144], [278, 110], [302, 132], [328, 124], [354, 148], [380, 128]];
    const peaks = [-400, 0, 400].flatMap(shift => base.map(([x, y]) => [x + shift, y])).concat([[800, 150]]);
    const ridge = `M-400,210 L${peaks.map(p => p.join(',')).join(' L')} L800,210 Z`;
    const snow = snowy
        ? peaks.filter(([, y]) => y < 132).map(([x, y]) =>
            `M${x - 9},${y + 10} L${x},${y} L${x + 9},${y + 11} L${x + 4},${y + 8} L${x},${y + 12} L${x - 4},${y + 8} Z`).join(' ')
        : '';

    let hills = 'M-400,230';
    for (let x = -400; x <= 800; x += 5) {
        hills += ` L${x},${(190 + 8 * Math.sin(x / 37) + 5 * Math.sin(x / 91)).toFixed(1)}`;
    }
    hills += ' L800,230 Z';

    let boards = '';
    for (let x = -404; x < 804; x += 19) {
        boards += `<rect x="${x}" y="${BATH_GRID.perch + 2}" width="17.5" height="48" rx="1"/>`;
    }

    const pine = (x, y, s) => `<path d="M${x},${y - 60 * s} L${x - 16 * s},${y - 22 * s} L${x - 7 * s},${y - 24 * s} L${x - 22 * s},${y} L${x + 22 * s},${y} L${x + 7 * s},${y - 24 * s} L${x + 16 * s},${y - 22 * s} Z"/>`;

    // Border bed along the fence
    let back = '';
    for (let i = 0, x = -392; x <= 792; i++, x += 26) {
        back += plantAt(x, 250 + ((i * 7) % 5) - 2, 0.75 + ((i * 13) % 5) * 0.06, backMix[i % backMix.length]);
    }

    // Two curved beds in front, either side of the bath, mirrored around it
    const frontSpots = [];
    [[330, 1.05, 40], [354, 1.25, 46], [376, 1.45, 54]].forEach(([y, s, step], row) => {
        for (let x = 98 - row * 9; x > -400; x -= step) frontSpots.push([x, y, s, row], [400 - x + (row % 2) * 6, y, s, row]);
    });
    // Left and right step through the mix at different rates, so each bed gets every plant
    const front = frontSpots.map(([x, y, s, row], i) => {
        const k = Math.floor(i / 2) + row * 3;
        return plantAt(x, y, s, frontMix[(i % 2 ? k * 5 + 2 : k) % frontMix.length]);
    }).join('');
    const bed = 'M-400,312 C-150,302 40,304 100,316 C126,322 136,352 128,380 L-400,380 Z';

    return `
    <svg class="bath-land" viewBox="0 0 ${BATH_GRID.w} ${BATH_GRID.h}" preserveAspectRatio="xMidYMax meet" aria-hidden="true">
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
            <linearGradient id="bath-mulch" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stop-color="#6e5340"/><stop offset="1" stop-color="#4f3a2c"/>
            </linearGradient>
        </defs>
        <path d="${ridge}" fill="url(#bath-far)"/>
        <path d="${snow}" fill="#f4f6fa" opacity="0.9"/>
        <path d="${hills}" fill="#6c7f63"/>
        <g fill="#3f5a45">${pine(-120, 200, 0.9)}${pine(-90, 200, 0.65)}${pine(30, 200, 1)}${pine(58, 200, 0.75)}${pine(352, 200, 1.1)}${pine(381, 200, 0.7)}${pine(500, 200, 0.95)}${pine(528, 200, 0.7)}</g>
        <g fill="#b48b62" stroke="#94704d" stroke-width="1">${boards}</g>
        <rect x="-404" y="${BATH_GRID.perch - 2}" width="1208" height="5" rx="1.5" fill="#8f6a48"/>
        <rect x="-400" y="238" width="1200" height="142" fill="url(#bath-grass)"/>
        <path d="M-400,236 L800,236 L800,252 C600,258 400,254 200,257 C0,254 -200,258 -400,252 Z" fill="url(#bath-mulch)"/>
        ${back}
        <ellipse cx="200" cy="352" rx="118" ry="21" fill="#c3b8a6"/>
        <g fill="#d6ccbb" stroke="#a99d8a" stroke-width="0.8">
            <path d="M96,350 L128,341 L150,347 L138,358 L104,360 Z"/><path d="M156,336 L196,333 L190,343 L160,345 Z"/>
            <path d="M204,333 L244,336 L240,345 L210,343 Z"/><path d="M250,347 L272,341 L304,350 L296,360 L262,358 Z"/>
            <path d="M144,362 L172,358 L178,369 L150,371 Z"/><path d="M222,358 L256,362 L250,371 L224,369 Z"/>
        </g>
        <ellipse cx="200" cy="355" rx="62" ry="8" fill="rgba(0,0,0,0.14)"/>
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
        <path d="${bed}" fill="url(#bath-mulch)" stroke="#8b7a66" stroke-width="2"/>
        <path d="${bed}" transform="matrix(-1 0 0 1 400 0)" fill="url(#bath-mulch)" stroke="#8b7a66" stroke-width="2"/>
        ${front}
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
        loadBathWeather(dateStr, isToday);
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

    loadBathWeather(dateStr, isToday);
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

    // Fit the scene's height; a wider or narrower box shows more or less yard
    // to the sides, so the fence and the birds never get cropped off the top.
    const scale = h / BATH_GRID.h;
    const viewWidth = w / scale;
    const svg = scene.querySelector('.bath-land');
    if (svg) svg.setAttribute('viewBox', `${(BATH_GRID.w - viewWidth) / 2} 0 ${viewWidth} ${BATH_GRID.h}`);
    const slotWidth = Math.round(Math.min(w * BATH_SLOT, h * 0.5));
    bath.layout = {
        w, h, scale, slotWidth,
        perch: BATH_GRID.perch * scale,
        rim: BATH_GRID.rim * scale,
        horizon: BATH_GRID.horizon * scale,
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

// ---- Weather (Open-Meteo via /api/weather; hourly for the viewed day) ----

const CLOUD_COUNT = 6;

function loadBathWeather(dateStr, isToday) {
    const fresh = Date.now() - bath.weatherFetched < 15 * 60 * 1000;
    if (bath.weatherDate === dateStr && (!isToday || fresh)) return;
    bath.weatherDate = dateStr;
    bath.weatherFetched = Date.now();
    if (bath.weather && bath.weather.date !== dateStr) bath.weather = null;
    fetch(`/api/weather/${dateStr}`)
        .then(r => r.ok ? r.json() : null)
        .then(data => {
            if (!data || data.date !== bath.date) return;
            bath.weather = data.hours && data.hours.length ? data : null;
            updateBathFrame();
        })
        .catch(() => {});
}

// What the sky is doing at ts: { cloud 0-1, precip 'rain'|'snow'|'', strength 0-1, fog 0-1, storm, temp }
function bathConditions(ts) {
    const hour = bath.weather && bath.weather.hours[Math.min(Math.floor(bathHour(ts)), 23)];
    if (!hour || hour.code === null) return { cloud: 0, precip: '', strength: 0, fog: 0, storm: false, temp: null };
    const c = hour.code;
    const w = { cloud: (hour.cloud || 0) / 100, precip: '', strength: 0, fog: 0, storm: c >= 95, temp: hour.temp };
    if (c === 45 || c === 48) w.fog = 0.55;
    if ((c >= 71 && c <= 77) || c === 85 || c === 86) {
        w.precip = 'snow';
        w.strength = c === 75 || c === 86 ? 1 : c === 73 ? 0.75 : 0.5;
    } else if ((c >= 51 && c <= 67) || (c >= 80 && c <= 82) || c >= 95) {
        w.precip = 'rain';
        w.strength = [55, 63, 65, 67, 81, 82].includes(c) || c >= 95 ? 0.9 : c >= 61 ? 0.65 : 0.4;
    }
    if (w.precip) w.cloud = Math.max(w.cloud, 0.9);
    return w;
}

function applyBathWeather(w, night) {
    const scene = document.getElementById('bath-scene');
    const visible = Math.round(w.cloud * CLOUD_COUNT);
    const grey = Math.min(Math.max((w.cloud - 0.6) / 0.4, 0), 1);
    document.querySelectorAll('#bath-clouds i').forEach((cloud, i) => {
        cloud.style.opacity = i < visible ? 1 : 0;
    });
    scene.style.setProperty('--cloud-color', mixHex('#ffffff', '#aeb4bc', grey * (w.precip ? 1 : 0.7)));
    scene.style.setProperty('--precip-strength', w.strength.toFixed(2));
    scene.style.setProperty('--fog', (w.fog * (1 - night * 0.6)).toFixed(2));
    scene.dataset.precip = w.precip;
    scene.classList.toggle('storm', w.storm);
    document.getElementById('bath-sun').style.visibility = w.cloud > 0.85 ? 'hidden' : '';
    document.getElementById('bath-moon').style.visibility = w.cloud > 0.85 ? 'hidden' : '';
    document.getElementById('bath-stars').style.visibility = w.cloud > 0.6 ? 'hidden' : '';
    document.getElementById('bath-clock-temp').textContent = w.temp !== null && bath.birds.length ? ` · ${w.temp}°` : '';
}

function setBathSky(ts) {
    const L = bath.layout;
    const scene = document.getElementById('bath-scene');
    const alt = sunAltitude(ts);
    let [top, bottom] = skyColors(alt);
    const night = Math.min(Math.max((2 - alt) / 10, 0), 1);

    // An overcast sky goes grey (dark grey at night)
    const w = bathConditions(ts);
    const overcast = Math.min(Math.max((w.cloud - 0.5) / 0.5, 0), 1) * 0.75;
    if (overcast > 0) {
        const grey = mixHex('#a3abb5', '#1c2029', night);
        top = mixHex(top, grey, overcast);
        bottom = mixHex(bottom, grey, overcast);
    }
    applyBathWeather(w, night);

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
    const returned = document.getElementById('bath-returned');
    returned.hidden = !item.returned_after_days;
    returned.textContent = item.returned_after_days ? formatReturn(item.returned_after_days) : '';
    const backyard = formatBackyardLine(item);
    document.getElementById('bath-backyard').textContent = backyard ? `🏡 ${backyard}` : '';
    document.getElementById('bath-credit').innerHTML = item.photo_failed ? '' : renderPhotoCredit(item.photo_credit);
    // Shown beside the scene on an iPad, where there's room for it
    const fact = item.fact
        ? `<b>${escapeHtml(item.fact.title)} ·</b> ${escapeHtml(item.fact.text).replace(/\n\n/g, '<br><br>')}`
        : escapeHtml(item.wiki_summary || '');
    document.getElementById('bath-fact').innerHTML = fact;

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
    openSheet(renderSpeciesDayCard(item, bath.date));
}

function setupBirdbath() {
    const scene = document.getElementById('bath-scene');
    if (!scene) return;
    const stars = document.getElementById('bath-stars');
    stars.innerHTML = STARS.map(([x, y]) => `<i style="left:${x}%;top:${y}%"></i>`).join('');
    // Clouds drift across at different heights, sizes and speeds
    document.getElementById('bath-clouds').innerHTML = Array.from({ length: CLOUD_COUNT }, (_, i) =>
        `<i style="top:${4 + (i * 37) % 30}%;--s:${(0.7 + (i * 0.29) % 0.6).toFixed(2)};animation-duration:${70 + i * 17}s;animation-delay:${-i * 23}s"></i>`).join('');

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
