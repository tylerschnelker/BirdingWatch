// Drawn birds: the birdbath's stand-in when a species has no photo or its
// photo fails to load. One side-view bird built from
// simple shapes and coloured per species: families (matched on the common
// name) give the shape and fallback colours, and backyard regulars get their
// own palettes. Every bird shares one viewBox with its feet at (61, 96), so
// `size` compares species fairly (a crow is bigger than a chickadee).

let birdArtCounter = 0;

const BIRD_BASE = {
    shape: 'songbird', size: 1, beak: 'thin', tail: 24, tailDrop: 0, headR: 13,
    bodyRx: 27, bodyRy: 19, tilt: -14, crest: false, tufts: false, marks: [],
    colors: {
        back: '#8a7a68', wing: null, tail: null, belly: '#e6ddd0', breast: null,
        face: null, crown: null, throat: null, mask: '#222222', brow: '#f4f2ee',
        cheek: '#f6f4ef', flank: '#c87a45', mark: '#2a2a2a', accent: '#f4f2ee',
        beak: '#3a3a3a', legs: '#6b5b4b', eye: '#141414', red: '#c8352e',
    },
};

// First match wins, so more specific patterns come first.
const BIRD_FAMILIES = [
    [/nighthawk/i, { beak: 'tiny', tilt: -4, tail: 22, colors: { back: '#6f6559', belly: '#b9ad9a', throat: '#f2efe8' }, marks: ['streaks'] }],
    [/owl/i, { shape: 'owl', size: 1.1, colors: { back: '#7d6248', belly: '#d8c4a4', face: '#c8ab84', eye: '#f2c230', beak: '#4a4038', legs: '#bfa98a' } }],
    [/hawk|eagle|falcon|kestrel|harrier/i, { size: 1.45, beak: 'hook', tilt: -34, tail: 24, colors: { back: '#6b4a32', belly: '#efe5d5', throat: '#efe5d5', beak: '#3b3b3b', legs: '#e3b938', eye: '#6e4519' }, marks: ['cere'] }],
    [/woodpecker|flicker|sapsucker/i, { beak: 'chisel', tilt: -30, tail: 20, colors: { back: '#1d1d1d', belly: '#f4f2ee', face: '#f4f2ee', crown: '#1d1d1d' }, marks: ['wingspots', 'mask'] }],
    [/dove|pigeon/i, { beak: 'dove', headR: 10.5, size: 1.15, tail: 30, tilt: -8, colors: { back: '#b9ab9b', belly: '#d8cdbf', face: '#c9bdb0', beak: '#3b3b3b', legs: '#c46a6a', eye: '#7a2a20' } }],
    [/scrub-jay|\bjay\b/i, { beak: 'crow', size: 1.15, tail: 32, crest: true, colors: { back: '#4a7fc1', belly: '#e8ecef', beak: '#222222' } }],
    [/\bcrow\b|raven|grackle|blackbird|cowbird|starling/i, { beak: 'crow', size: 1.25, colors: { back: '#1c1b22', belly: '#1c1b22', beak: '#151515', legs: '#2a2a2a', eye: '#000000' } }],
    [/swan|goose|duck|teal|merganser|gull|grebe|coot/i, { beak: 'duck', size: 1.3, tail: 12, tilt: -2, colors: { back: '#9a9a9a', belly: '#e8e8e8', beak: '#d9a036', legs: '#d9a036' } }],
    [/heron|crane|rail|sora|phalarope|kingfisher|killdeer|sandpiper|egret|cuckoo/i, { beak: 'long', size: 1.1, colors: { back: '#7c8a96', belly: '#dfe3e6' } }],
    [/turkey|pheasant|quail|grouse/i, { beak: 'dove', size: 1.6, headR: 9, tail: 22, colors: { back: '#5a4433', belly: '#4a3a2c', beak: '#bba887' } }],
    [/hummingbird/i, { beak: 'needle', size: 0.55, tail: 14, colors: { back: '#3f8f5a', belly: '#eef0ea', throat: '#c2185b', beak: '#222222' } }],
    [/swallow|martin/i, { beak: 'tiny', tail: 26, tilt: -6, size: 0.9, colors: { back: '#2f5a8c', belly: '#f2f2ef', beak: '#222222' }, marks: ['forked'] }],
    [/wren|creeper|dipper/i, { beak: 'decurved', size: 0.75, tail: 18, tailDrop: -22, colors: { back: '#8b6d52', belly: '#cdb79e' } }],
    [/nuthatch/i, { beak: 'chisel', size: 0.8, tail: 12, tilt: -4, colors: { back: '#7f93a8', belly: '#f2f0ec', face: '#f2f0ec', crown: '#1e1e22' } }],
    [/chickadee|titmouse|bushtit|kinglet/i, { beak: 'tiny', size: 0.78, headR: 14, colors: { back: '#8f9399', belly: '#f0ede6' } }],
    [/finch|grosbeak|siskin|redpoll|crossbill/i, { beak: 'cone', size: 0.85, colors: { back: '#7d6754', belly: '#ede4d6', beak: '#a89888' }, marks: ['streaks'] }],
    [/sparrow|junco|towhee/i, { beak: 'cone', size: 0.88, colors: { back: '#8a6b4c', belly: '#ddd6cb', face: '#9a9188', crown: '#8a5a3a', beak: '#6b5d52' }, marks: ['streaks'] }],
    [/warbler|tanager|oriole|vireo/i, { size: 0.85, colors: { back: '#9a9a3c', belly: '#f2d544' }, marks: ['wingbars'] }],
    [/flycatcher|phoebe|kingbird|solitaire|pewee/i, { size: 0.92, colors: { back: '#8a8a80', belly: '#e9e5d8', beak: '#222222' } }],
    [/bluebird/i, { size: 0.92, colors: { back: '#3a63b8', breast: '#c9733e', belly: '#eae6e0' } }],
    [/robin|thrush/i, { size: 1.1, colors: { back: '#5c5650', belly: '#d8692c', beak: '#e8b628' } }],
    [/waxwing/i, { size: 0.95, crest: true, beak: 'tiny', colors: { back: '#b39a7a', belly: '#e3d58a' }, marks: ['mask'] }],
];

// Backyard regulars and anything with a distinctive look. Colours are for the
// most recognisable plumage (usually the adult male).
const BIRD_SPECIES = {
    'House Finch': { colors: { back: '#86705e', wing: '#77604f', belly: '#efe6da', breast: '#d6404a', face: '#d6404a', crown: '#d6404a', mark: '#8b6e5a' }, marks: ['streaks', 'wingbars'] },
    "Cassin's Finch": { colors: { back: '#9a7f72', wing: '#7f6658', belly: '#f2e9e6', breast: '#e8a0ad', face: '#e8a0ad', crown: '#d33d5c', mark: '#a28a7a' }, marks: ['streaks'] },
    'Spotted Towhee': { size: 0.95, tail: 30, colors: { back: '#1f1a17', belly: '#f4f1ec', breast: '#1f1a17', face: '#1f1a17', flank: '#c0622d', eye: '#c0262d', beak: '#222222', accent: '#f4f1ec' }, marks: ['flanks', 'wingspots'] },
    'Green-tailed Towhee': { size: 0.9, tail: 28, colors: { back: '#86907a', wing: '#7f9a3a', tail: '#7f9a3a', belly: '#e8e8e2', breast: '#9aa0a2', face: '#8e9496', crown: '#b8572c', throat: '#f6f6f2', beak: '#333333' } },
    'Blue Jay': { colors: { back: '#4a7fc1', wing: '#3b78c8', tail: '#3a74c2', belly: '#eef1f4', breast: '#e2e6ea', face: '#f2f4f6', crown: '#4a7fc1', mark: '#1a1a1a', accent: '#f6f6f6' }, marks: ['necklace', 'wingbars'] },
    "Woodhouse's Scrub-Jay": { crest: false, tail: 36, colors: { back: '#4f7cbf', wing: '#4877c0', belly: '#e6e3dc', breast: '#d9d6cf', face: '#42679c', throat: '#f2f0ea', crown: '#4f7cbf' }, marks: ['brow'] },
    'American Crow': { size: 1.35 },
    'Common Raven': { size: 1.5, headR: 14, beak: 'hook' },
    'Great-tailed Grackle': { size: 1.25, tail: 40, tailDrop: 4, colors: { wing: '#2b2244', tail: '#231c3a', eye: '#f2df3a' } },
    'Common Grackle': { size: 1.15, tail: 34, colors: { face: '#2a2f5a', crown: '#2a2f5a', wing: '#2b2244', eye: '#f2df3a' } },
    'Brown-headed Cowbird': { size: 1, beak: 'cone', colors: { face: '#5a4434', crown: '#5a4434' } },
    'Red-winged Blackbird': { size: 1, colors: { red: '#d63a2a' }, marks: ['epaulet'] },
    'European Starling': { size: 1, beak: 'long', tail: 14, colors: { back: '#1f1c22', belly: '#26222b', beak: '#e6c229', accent: '#e9e3d0' }, marks: ['bellyspots', 'wingspots'] },
    'Northern Flicker': { size: 1.2, colors: { back: '#a08872', wing: '#9c8068', tail: '#2a2622', belly: '#efe2d0', breast: '#efe2d0', face: '#c4b6a8', crown: '#a87d5a', mark: '#1e1e1e', accent: '#1e1e1e' }, marks: ['bellyspots', 'bib', 'mustache', 'wingspots'] },
    'Downy Woodpecker': { size: 0.85, beak: 'chisel', colors: { accent: '#f4f2ee' }, marks: ['wingspots', 'mask', 'nape'] },
    'Hairy Woodpecker': { size: 1, colors: { accent: '#f4f2ee' }, marks: ['wingspots', 'mask', 'nape'] },
    'Pileated Woodpecker': { size: 1.45, crest: true, colors: { back: '#1a1a1a', belly: '#1a1a1a', breast: '#1a1a1a', face: '#1a1a1a', crown: '#d0302a', cheek: '#f2f2f2' }, marks: ['cheek', 'mustache'] },
    'Red-bellied Woodpecker': { size: 1.05, colors: { back: '#e9e6df', wing: '#2a2a2a', belly: '#e6ded2', face: '#ece7de', crown: '#d0302a', accent: '#f4f2ee' }, marks: ['wingspots'] },
    "Williamson's Sapsucker": { colors: { belly: '#f2d544', breast: '#1d1d1d', throat: '#d0302a', accent: '#f4f2ee' }, marks: ['wingspots', 'brow'] },
    'Black-capped Chickadee': { colors: { back: '#8f9399', wing: '#7d8187', tail: '#80848a', belly: '#f2efe8', flank: '#e3cfae', face: '#f6f4ef', crown: '#1b1b1d', throat: '#1b1b1d', beak: '#222222' }, marks: ['flanks', 'bib'] },
    'Mountain Chickadee': { colors: { back: '#8f9399', belly: '#efece6', face: '#f6f4ef', crown: '#1b1b1d', throat: '#1b1b1d', beak: '#222222' }, marks: ['bib', 'brow', 'mask'] },
    'Bushtit': { size: 0.62, tail: 30, bodyRx: 23, bodyRy: 18, colors: { back: '#8e8a84', wing: '#86827c', belly: '#cfc8bd', face: '#a39276', crown: '#9a8f80', beak: '#333333' } },
    'Ruby-crowned Kinglet': { size: 0.62, colors: { back: '#8a9466', belly: '#dfe2cf', crown: '#d0302a' }, marks: ['wingbars', 'eyering'] },
    'Black-billed Magpie': { size: 1.2, beak: 'crow', tail: 54, tailDrop: 6, colors: { back: '#15171c', wing: '#1c3040', tail: '#1d3a3a', belly: '#f5f5f5', breast: '#15171c', face: '#15171c' }, marks: ['shoulder'] },
    'Red-breasted Nuthatch': { colors: { back: '#7f93a8', wing: '#7a8ea3', belly: '#d98a52', breast: '#e3a571', face: '#f4f2ee', crown: '#1e1e22', mask: '#1e1e22' }, marks: ['mask', 'brow'] },
    'White-breasted Nuthatch': { size: 0.9, colors: { flank: '#a8573a' }, marks: ['flanks'] },
    'Pygmy Nuthatch': { size: 0.65, colors: { crown: '#6f6656', face: '#6f6656', belly: '#ebe5d9', throat: '#f4f2ee' } },
    'American Robin': { colors: { back: '#5c5650', wing: '#57514b', belly: '#d8692c', breast: '#d26126', face: '#2f2b29', crown: '#2f2b29', beak: '#e8b628' }, marks: ['eyering'] },
    "Townsend's Solitaire": { size: 1, tail: 30, colors: { back: '#8d9196', belly: '#b5b8bb', face: '#9a9ea2', beak: '#222222' }, marks: ['eyering', 'wingbars'] },
    'American Goldfinch': { size: 0.78, colors: { back: '#f3cf2e', wing: '#1e1e1e', tail: '#1e1e1e', belly: '#f6d84a', face: '#f3cf2e', crown: '#1e1e1e', beak: '#f0a35e', accent: '#f4f2ee' }, marks: ['wingbars'] },
    'Lesser Goldfinch': { size: 0.72, colors: { back: '#4d5a22', wing: '#1e1e1e', tail: '#1e1e1e', belly: '#f2d03a', face: '#4d5a22', crown: '#1e1e1e', beak: '#555555', accent: '#f4f2ee' }, marks: ['wingbars'] },
    'Pine Siskin': { size: 0.75, beak: 'thin', colors: { back: '#8a7d68', belly: '#ebe5d6', mark: '#6f6250', accent: '#f0cf3a' }, marks: ['streaks', 'wingbars'] },
    'Common Redpoll': { size: 0.75, colors: { back: '#9a8c7c', belly: '#f2ece6', breast: '#eba7b4', crown: '#c8283a', throat: '#222222', beak: '#e0c040' }, marks: ['streaks', 'bib'] },
    'Red Crossbill': { colors: { back: '#b8443c', wing: '#4a3a34', belly: '#c95a4a', face: '#c24a40', beak: '#4a4a4a' } },
    'Pine Grosbeak': { size: 1.05, colors: { back: '#c4526a', wing: '#4a4a4e', belly: '#cf7a88', face: '#c4526a', beak: '#333333' }, marks: ['wingbars'] },
    'Evening Grosbeak': { size: 1, beak: 'cone', colors: { back: '#b39a2e', wing: '#1e1e1e', tail: '#1e1e1e', belly: '#e9c73a', face: '#5e4a2a', crown: '#3a3024', brow: '#f2d03a', beak: '#c8d6a0', accent: '#f4f2ee' }, marks: ['brow', 'wingbars'] },
    'Black-headed Grosbeak': { colors: { back: '#3a2e26', wing: '#1e1e1e', belly: '#e5a35e', face: '#1e1e1e', beak: '#d8d0c0', accent: '#f4f2ee' }, marks: ['wingbars'] },
    'Dark-eyed Junco': { size: 0.85, colors: { back: '#6e7076', wing: '#62646a', belly: '#f4f3ef', breast: '#6e7076', face: '#6e7076', crown: '#6e7076', beak: '#e8b4a8' } },
    'House Sparrow': { size: 0.9, colors: { back: '#8c6a48', wing: '#7a5a3c', belly: '#c9c5bd', face: '#d9d6cf', crown: '#8e8e8e', throat: '#1e1e1e', beak: '#333333', mark: '#2a2018' }, marks: ['bib', 'wingbars'] },
    'American Tree Sparrow': { colors: { face: '#a7a7a2', crown: '#a8552e', belly: '#e2ddd3', beak: '#c9a640' } },
    'White-throated Sparrow': { colors: { face: '#8f8a84', crown: '#1e1e1e', brow: '#f2f2ee', throat: '#f6f6f2', beak: '#555555' }, marks: ['brow'] },
    'Cedar Waxwing': { colors: { back: '#b39a7a', wing: '#7f7a74', tail: '#6f6a64', belly: '#e9d77a', breast: '#c4ab8a', face: '#b39a7a', crown: '#b39a7a', mask: '#151515' } },
    'Bohemian Waxwing': { colors: { back: '#9a8f86', wing: '#5e5a56', belly: '#a8a098', face: '#b8977a', crown: '#b8977a', mask: '#151515' } },
    "Say's Phoebe": { colors: { back: '#8a8580', belly: '#d69a6b', breast: '#b5a596', face: '#6f6a66', crown: '#6f6a66', tail: '#2a2a2a' } },
    'Canyon Wren': { size: 0.85, colors: { back: '#8a5a3a', belly: '#9a4a2a', breast: '#f6f4ef', throat: '#f6f4ef', face: '#8a6a52' } },
    'House Wren': { colors: { back: '#8b6d52', belly: '#c9b39a' } },
    'Brown Creeper': { colors: { back: '#7b5d43', belly: '#f4f2ee', accent: '#e9dfd0' }, marks: ['wingspots'] },
    'American Dipper': { size: 0.95, beak: 'thin', tailDrop: -12, colors: { back: '#6c6e72', belly: '#6c6e72' } },
    'Western Bluebird': { colors: { face: '#3a63b8', crown: '#3a63b8', throat: '#3a63b8' } },
    'Eastern Bluebird': { colors: { throat: '#c9733e', belly: '#f2efe9' } },
    'Western Tanager': { size: 0.9, colors: { back: '#e8c52e', wing: '#1e1e1e', tail: '#1e1e1e', belly: '#f2d544', face: '#d8402e', crown: '#d8402e', accent: '#f4f2ee' }, marks: ['wingbars'] },
    'Baltimore Oriole': { colors: { back: '#1e1e1e', wing: '#1e1e1e', tail: '#e07a1e', belly: '#ef8a22', breast: '#ef8a22', face: '#1e1e1e', throat: '#1e1e1e', accent: '#f4f2ee' }, marks: ['wingbars'] },
    'Orchard Oriole': { colors: { back: '#1e1e1e', wing: '#1e1e1e', belly: '#9a3a22', face: '#1e1e1e', throat: '#1e1e1e', accent: '#f4f2ee' }, marks: ['wingbars'] },
    'Purple Martin': { size: 1.05, colors: { back: '#2b2e5c', belly: '#2b2e5c' } },
    'Barn Swallow': { colors: { back: '#24497e', belly: '#e9b98a', throat: '#a8552e' } },
    'Violet-green Swallow': { colors: { back: '#3f7a5a', wing: '#4a3f6e', belly: '#f6f6f2', face: '#f6f6f2' } },
    'Tree Swallow': { colors: { back: '#2a5f9a' } },
    'Broad-tailed Hummingbird': { colors: { throat: '#c2185b', flank: '#d9b08a' }, marks: ['flanks'] },
    'Rufous Hummingbird': { colors: { back: '#c8662a', belly: '#f2e4d6', throat: '#e0542a', face: '#c8662a' } },
    'Red-tailed Hawk': { size: 1.5, colors: { back: '#6b4a32', wing: '#5e3f2a', tail: '#b8562e', belly: '#f0e6d6', breast: '#f3eadc', face: '#6b4a32', throat: '#f3eadc', mark: '#5a3a24' }, marks: ['belt', 'cere'] },
    "Cooper's Hawk": { size: 1.3, tail: 34, colors: { back: '#5d6774', belly: '#f2e2d6', face: '#c98a62', crown: '#2e3440', mark: '#c86a3a', eye: '#d8501e' }, marks: ['streaks', 'cere'] },
    'Bald Eagle': { size: 1.8, colors: { back: '#4a3426', wing: '#3e2b1f', tail: '#f4f2ee', belly: '#4a3426', breast: '#4a3426', face: '#f4f2ee', crown: '#f4f2ee', throat: '#f4f2ee', beak: '#e8b628', eye: '#e8b628' } },
    'Peregrine Falcon': { size: 1.25, beak: 'hook', colors: { back: '#4f5866', belly: '#ece6dc', face: '#f2efe8', crown: '#1f2329', mask: '#1f2329' }, marks: ['mustache'] },
    'Eurasian Collared-Dove': { size: 1.15, tail: 30, colors: { back: '#cdbfae', wing: '#c2b3a2', tail: '#bcae9e', belly: '#e0d6cc', face: '#d8cfc6', mark: '#1e1e1e' }, marks: ['collar'] },
    'Rock Pigeon': { size: 1.25, colors: { back: '#9aa0a8', wing: '#a3a9b0', tail: '#8e949c', belly: '#8f96a0', breast: '#6a7f78', face: '#5d6470', mark: '#2a2a2e', eye: '#e07a1e' }, marks: ['wingbars-dark'] },
    'Mourning Dove': { size: 1.05, tail: 34, colors: { back: '#b39c84', wing: '#a8917a', belly: '#d9c3a9', face: '#c9b096', accent: '#2a2a2a' }, marks: ['wingspots'] },
    'White-winged Dove': { colors: { back: '#a89a88', belly: '#c9bcac', accent: '#f4f2ee' }, marks: ['wingbars'] },
    'Great Horned Owl': { size: 1.45, tufts: true, colors: { back: '#7b5e43', belly: '#cdb393', face: '#c9935a', throat: '#f4f2ee' } },
    'Eastern Screech-Owl': { size: 0.85, tufts: true, colors: { back: '#8b8a86', belly: '#c9c6bf', face: '#a9a7a1' } },
    'Long-eared Owl': { size: 1.1, tufts: true, colors: { back: '#6f5640', belly: '#cdb393', face: '#d08a4a', eye: '#f28a1e' } },
    'Barn Owl': { size: 1.15, colors: { back: '#c99a62', belly: '#f6f0e6', face: '#fbf8f2', eye: '#1a1a1a' } },
    'Burrowing Owl': { size: 0.85, colors: { back: '#8a6a4a', belly: '#e8dccb', face: '#c9b394' } },
    'Northern Saw-whet Owl': { size: 0.75, colors: { back: '#7a5236', belly: '#efe4d6', face: '#efe4d6' } },
    'Wild Turkey': { colors: { face: '#c8d3e3', crown: '#c8d3e3', throat: '#c9302c', beak: '#bba887' } },
    'Ring-necked Pheasant': { size: 1.4, tail: 40, colors: { back: '#b8682e', belly: '#a85a28', face: '#2c5a46', crown: '#2c5a46', mask: '#c9302c', mark: '#f4f2ee' }, marks: ['mask', 'collar'] },
    'Trumpeter Swan': { size: 1.6, colors: { back: '#f4f4f2', belly: '#f4f4f2', beak: '#1e1e1e', legs: '#1e1e1e' } },
    'Tundra Swan': { size: 1.5, colors: { back: '#f4f4f2', belly: '#f4f4f2', beak: '#1e1e1e', legs: '#1e1e1e' } },
    'Green-winged Teal': { size: 0.95, colors: { back: '#8e8e8a', belly: '#d9d2c4', face: '#9a4a2a', crown: '#9a4a2a', mask: '#2f7a4a', beak: '#333333' }, marks: ['mask'] },
    'Hooded Merganser': { crest: true, colors: { back: '#1e1e1e', belly: '#f4f2ee', flank: '#b8743a', face: '#1e1e1e', crown: '#1e1e1e', cheek: '#f4f2ee', beak: '#222222' }, marks: ['flanks', 'cheek'] },
    'Ring-billed Gull': { colors: { back: '#b9c0c8', wing: '#a9b0b8', tail: '#2a2a2a', belly: '#f6f6f4', face: '#f6f6f4', beak: '#e6c229' } },
    'Belted Kingfisher': { size: 1.05, headR: 15, crest: true, beak: 'chisel', colors: { back: '#5d7fa6', belly: '#f4f2ee', face: '#5d7fa6', crown: '#5d7fa6', throat: '#f4f2ee' }, marks: ['necklace'] },
    'Great Blue Heron': { size: 1.6, colors: { back: '#7c8a9a', belly: '#9aa4b0', face: '#f2f2ee', crown: '#1e1e1e', beak: '#d9b23a' } },
    'Black-crowned Night-Heron': { size: 1.3, colors: { back: '#3a4a5a', wing: '#9aa4ac', belly: '#e9ebec', face: '#e9ebec', crown: '#2a3644', eye: '#c8202a' } },
    'Sandhill Crane': { size: 1.6, colors: { back: '#9a9a9a', belly: '#b8b8b8', crown: '#c9302c', face: '#f2f2ee' } },
    'Yellow-billed Cuckoo': { tail: 34, beak: 'decurved', colors: { back: '#8a7d6a', belly: '#f2efe8', beak: '#e6c229' } },
    'Eastern Kingbird': { colors: { back: '#3a3a3e', belly: '#f6f6f2', face: '#1e1e22', crown: '#1e1e22' } },
    'Western Kingbird': { colors: { back: '#9aa0a2', wing: '#6a6e72', tail: '#2a2a2a', belly: '#f2d544', breast: '#c9cccc' } },
};

const BIRD_DERIVED_COLORS = [
    ['wing', 'back'], ['tail', 'wing'], ['breast', 'belly'],
    ['face', 'back'], ['crown', 'face'], ['throat', 'breast'],
];

function resolveBirdStyle(speciesCommon) {
    const family = (BIRD_FAMILIES.find(([pattern]) => pattern.test(speciesCommon)) || [null, {}])[1];
    const own = BIRD_SPECIES[speciesCommon] || {};
    const style = { ...BIRD_BASE, ...family, ...own };
    style.colors = { ...BIRD_BASE.colors, ...family.colors, ...own.colors };
    style.marks = own.marks || family.marks || [];
    // Unset parts follow a related part (the crown follows the face, etc.). A
    // species that recolours the face also gets that crown, not the family's.
    const c = style.colors, ownColors = own.colors || {}, familyColors = family.colors || {};
    for (const [part, from] of BIRD_DERIVED_COLORS) {
        if (ownColors[part]) c[part] = ownColors[part];
        else if (ownColors[from] || !familyColors[part]) c[part] = c[from];
        else c[part] = familyColors[part];
    }
    return style;
}

// SVG markup for one species. The bird faces right; callers mirror it.
function birdSvg(speciesCommon) {
    const style = resolveBirdStyle(speciesCommon);
    const id = `bird${++birdArtCounter}`;
    const body = style.shape === 'owl' ? owlParts(style) : songbirdParts(style, id);
    // Scaled around the feet, so every bird stands on the same spot.
    return `<svg class="bird-art" viewBox="-30 -10 170 110" aria-hidden="true">
        <g transform="translate(61 96) scale(${style.size}) translate(-61 -96)">${body}</g>
    </svg>`;
}

function songbirdParts(s, id) {
    const c = s.colors;
    const m = name => s.marks.includes(name);
    const hx = 84, hy = 42, r = s.headR;
    const bx = 60, by = 64;
    const t = s.tilt * Math.PI / 180;
    const rearX = bx - s.bodyRx * Math.cos(t);
    const rearY = by - s.bodyRx * Math.sin(t);
    const tipY = rearY - s.tail * Math.sin(t) + s.tailDrop;
    const tipX = rearX - s.tail;
    const rot = `rotate(${s.tilt} ${bx} ${by})`;

    const tail = m('forked')
        ? `M${rearX + 8},${rearY - 6} L${tipX},${tipY - 3} L${tipX + 9},${tipY + 1} L${tipX},${tipY + 5} L${rearX + 8},${rearY + 3} Z`
        : `M${rearX + 8},${rearY - 6} L${tipX},${tipY - 3} L${tipX + 2},${tipY + 4} L${rearX + 8},${rearY + 3} Z`;

    const crest = s.crest
        ? `<path d="M${hx - 4},${hy - r + 2} L${hx - r - 9},${hy - r - 9} L${hx - r + 1},${hy - 2} Z" fill="${c.crown}"/>`
        : '';

    // Head and body markings, clipped to the bird's outline.
    const marks = [];
    marks.push(`<ellipse cx="72" cy="80" rx="32" ry="14" transform="${rot}" fill="${c.belly}"/>`);
    marks.push(`<ellipse cx="83" cy="61" rx="13" ry="12" fill="${c.breast}"/>`);
    if (m('flanks')) marks.push(`<ellipse cx="62" cy="73" rx="17" ry="7" transform="${rot}" fill="${c.flank}"/>`);
    if (m('streaks')) {
        [[78, 64], [84, 68], [72, 70], [79, 74], [66, 76], [73, 79], [86, 62]].forEach(([x, y]) =>
            marks.push(`<path d="M${x},${y} l-1.5,4" stroke="${c.mark}" stroke-width="1.8" stroke-linecap="round" opacity="0.55"/>`));
    }
    if (m('bellyspots')) {
        [[74, 70], [81, 67], [68, 76], [77, 77], [84, 73], [70, 82], [62, 79]].forEach(([x, y]) =>
            marks.push(`<circle cx="${x}" cy="${y}" r="1.7" fill="${c.accent}"/>`));
    }
    if (m('belt')) {
        [[64, 72], [70, 74], [76, 73], [82, 71], [67, 77], [74, 78]].forEach(([x, y]) =>
            marks.push(`<path d="M${x},${y} l-2,3" stroke="${c.mark}" stroke-width="2.4" stroke-linecap="round"/>`));
    }
    marks.push(`<circle cx="${hx}" cy="${hy}" r="${r}" fill="${c.face}"/>`);
    marks.push(`<rect x="${hx - r - 2}" y="${hy - r - 2}" width="${2 * r + 4}" height="${r * 0.85}" clip-path="url(#${id}h)" fill="${c.crown}"/>`);
    if (m('cheek')) marks.push(`<ellipse cx="${hx - 1}" cy="${hy + 5}" rx="${r * 0.62}" ry="${r * 0.36}" fill="${c.cheek}"/>`);
    if (m('mask')) marks.push(`<path d="M${hx - r - 1},${hy - 1} L${hx + r + 1},${hy - 2.5} L${hx + r + 1},${hy + 2.5} L${hx - r - 1},${hy + 4} Z" fill="${c.mask}"/>`);
    if (m('brow')) marks.push(`<path d="M${hx - r + 1},${hy - 4.5} L${hx + r - 2},${hy - 6} L${hx + r - 2},${hy - 4} L${hx - r + 1},${hy - 2.5} Z" fill="${c.brow}"/>`);
    marks.push(`<ellipse cx="${hx + 5}" cy="${hy + 12}" rx="8" ry="6.5" fill="${c.throat}"/>`);
    if (m('bib')) marks.push(`<ellipse cx="${hx + 4}" cy="${hy + 12}" rx="7.5" ry="5.5" fill="${s.colors.throat === s.colors.breast ? c.mark : c.throat}"/>`);
    if (m('necklace')) marks.push(`<path d="M${hx - 7},${hy + 7} Q${hx + 2},${hy + 18} ${hx + 11},${hy + 9}" stroke="${c.mark}" stroke-width="2.6" fill="none"/>`);
    if (m('collar')) marks.push(`<path d="M${hx - r - 1},${hy + 4} L${hx - r + 8},${hy + 6} L${hx - r + 7},${hy + 9.5} L${hx - r - 2},${hy + 8} Z" fill="${c.mark}"/>`);
    if (m('mustache')) marks.push(`<path d="M${hx + 8},${hy + 4} L${hx + 1},${hy + 9}" stroke="${c.red}" stroke-width="3.2" stroke-linecap="round"/>`);
    if (m('nape')) marks.push(`<circle cx="${hx - r + 2}" cy="${hy - 2}" r="3.4" fill="${c.red}"/>`);
    // A little light on top and shade underneath, for roundness.
    marks.push(`<ellipse cx="66" cy="50" rx="24" ry="9" transform="${rot}" fill="#ffffff" opacity="0.12"/>`);
    marks.push(`<ellipse cx="62" cy="84" rx="26" ry="7" transform="${rot}" fill="#000000" opacity="0.1"/>`);

    const wingMarks = [];
    if (m('wingbars')) wingMarks.push(`<path d="M63,56 L58,66 M55,57 L50,66" stroke="${c.accent}" stroke-width="2.2" stroke-linecap="round"/>`);
    if (m('wingbars-dark')) wingMarks.push(`<path d="M58,57 L54,66 M50,58 L46,66" stroke="${c.mark}" stroke-width="2.6" stroke-linecap="round"/>`);
    if (m('wingspots')) {
        [[64, 58], [56, 59], [48, 61], [60, 63], [52, 64], [44, 64]].forEach(([x, y]) =>
            wingMarks.push(`<circle cx="${x}" cy="${y}" r="1.7" fill="${c.accent}"/>`));
    }
    if (m('shoulder')) wingMarks.push(`<ellipse cx="64" cy="56" rx="12" ry="3.6" fill="#f5f5f5"/>`);
    if (m('epaulet')) wingMarks.push(`<ellipse cx="70" cy="56" rx="6" ry="3.2" fill="${c.red}"/><path d="M64,59 l12,-1" stroke="#e6c229" stroke-width="1.4"/>`);

    const er = r / 13;
    const ex = hx + 4.5, ey = hy - 1.5;
    const eyeRing = m('eyering') ? `<circle cx="${ex}" cy="${ey}" r="${4.2 * er}" fill="#f6f4ef"/>` : '';
    const cere = m('cere') ? `<path d="M${hx + r - 2.5},${hy - 4} l4,1 l0,5 l-4,1 Z" fill="#e3b938"/>` : '';

    return `
        <defs>
            <clipPath id="${id}s">
                <ellipse cx="${bx}" cy="${by}" rx="${s.bodyRx}" ry="${s.bodyRy}" transform="${rot}"/>
                <circle cx="${hx}" cy="${hy}" r="${r}"/>
                <ellipse cx="${hx - 5}" cy="${hy + 11}" rx="${r * 0.85}" ry="${r * 0.8}"/>
            </clipPath>
            <clipPath id="${id}h"><circle cx="${hx}" cy="${hy}" r="${r}"/></clipPath>
        </defs>
        <g stroke="${c.legs}" stroke-width="2.6" stroke-linecap="round" fill="none">
            <path d="M57,78 L55,95 M50,96 L60,96"/>
            <path d="M65,78 L65,95 M61,96 L70,96"/>
        </g>
        <path d="${tail}" fill="${c.tail}" stroke="rgba(0,0,0,0.18)" stroke-width="1"/>
        ${crest}
        <g clip-path="url(#${id}s)">
            <rect x="0" y="0" width="140" height="110" fill="${c.back}"/>
            ${marks.join('')}
        </g>
        <g clip-path="url(#${id}s)" fill="none" stroke="rgba(0,0,0,0.22)" stroke-width="2.4">
            <ellipse cx="${bx}" cy="${by}" rx="${s.bodyRx}" ry="${s.bodyRy}" transform="${rot}"/>
            <circle cx="${hx}" cy="${hy}" r="${r}"/>
        </g>
        <g transform="${rot}">
            <path d="M77,55 C66,48 46,51 34,63 C47,69 66,70 78,63 Z" fill="${c.wing}" stroke="rgba(0,0,0,0.2)" stroke-width="1"/>
            ${wingMarks.join('')}
        </g>
        ${eyeRing}
        <circle cx="${ex}" cy="${ey}" r="${2.7 * er}" fill="${c.eye}"/>
        <circle cx="${ex + 0.9 * er}" cy="${ey - 0.9 * er}" r="${0.95 * er}" fill="#ffffff"/>
        <path d="${beakPath(s.beak, hx + r - 1.5, hy + 1)}" fill="${c.beak}"/>
        ${cere}
    `;
}

function beakPath(type, x, y) {
    const beaks = {
        cone: `M${x},${y - 5} L${x + 11},${y} L${x},${y + 5} Z`,
        thin: `M${x},${y - 2.5} L${x + 10},${y} L${x},${y + 2.2} Z`,
        tiny: `M${x},${y - 2.5} L${x + 6},${y} L${x},${y + 2.5} Z`,
        dove: `M${x},${y - 2} L${x + 7},${y + 0.5} L${x},${y + 2.5} Z`,
        chisel: `M${x},${y - 3} L${x + 16},${y} L${x},${y + 3} Z`,
        long: `M${x},${y - 2.5} L${x + 20},${y + 1} L${x},${y + 2.5} Z`,
        needle: `M${x},${y - 1.4} L${x + 24},${y + 0.5} L${x},${y + 1.4} Z`,
        crow: `M${x},${y - 5} Q${x + 12},${y - 4} ${x + 16},${y + 1} L${x},${y + 5} Z`,
        hook: `M${x},${y - 5} Q${x + 10},${y - 6} ${x + 11},${y + 3} L${x + 7},${y + 1} L${x},${y + 4} Z`,
        duck: `M${x},${y - 3.5} L${x + 13},${y - 1.5} Q${x + 16},${y + 1} ${x + 13},${y + 3} L${x},${y + 3.5} Z`,
        decurved: `M${x},${y - 2.5} Q${x + 12},${y - 2} ${x + 16},${y + 5} Q${x + 10},${y + 1.5} ${x},${y + 2} Z`,
    };
    return beaks[type] || beaks.thin;
}

// Owls stand upright and face you, so they get their own drawing.
function owlParts(s) {
    const c = s.colors;
    const bars = [[54, 66], [64, 64], [58, 74], [68, 72], [55, 82], [65, 81]].map(([x, y]) =>
        `<path d="M${x},${y} l5,0" stroke="${c.back}" stroke-width="2" stroke-linecap="round" opacity="0.7"/>`).join('');
    const tufts = s.tufts
        ? `<path d="M47,32 L43,13 L56,26 Z M75,32 L79,13 L66,26 Z" fill="${c.back}"/>`
        : '';
    const throat = c.throat !== c.breast
        ? `<ellipse cx="61" cy="53" rx="8" ry="3.2" fill="${c.throat}"/>`
        : '';
    return `
        <g stroke="${c.legs}" stroke-width="3" stroke-linecap="round">
            <path d="M54,93 L52,96 M56,93 L56,96.5 M58,93 L60,96"/>
            <path d="M64,93 L62,96 M66,93 L66,96.5 M68,93 L70,96"/>
        </g>
        ${tufts}
        <ellipse cx="61" cy="66" rx="23" ry="28" fill="${c.back}" stroke="rgba(0,0,0,0.22)" stroke-width="1.2"/>
        <ellipse cx="61" cy="71" rx="15" ry="20" fill="${c.belly}"/>
        ${bars}
        <ellipse cx="40" cy="67" rx="7" ry="19" transform="rotate(8 40 67)" fill="${c.back}" stroke="rgba(0,0,0,0.25)" stroke-width="1"/>
        <ellipse cx="82" cy="67" rx="7" ry="19" transform="rotate(-8 82 67)" fill="${c.back}" stroke="rgba(0,0,0,0.25)" stroke-width="1"/>
        <ellipse cx="61" cy="38" rx="20" ry="17" fill="${c.back}" stroke="rgba(0,0,0,0.22)" stroke-width="1.2"/>
        <path d="M61,30 C50,24 41,30 42,40 C43,49 53,51 61,47 C69,51 79,49 80,40 C81,30 72,24 61,30 Z" fill="${c.face}"/>
        ${throat}
        <circle cx="54" cy="39" r="5.4" fill="${c.eye}"/>
        <circle cx="68" cy="39" r="5.4" fill="${c.eye}"/>
        <circle cx="54" cy="39" r="2.6" fill="#111111"/>
        <circle cx="68" cy="39" r="2.6" fill="#111111"/>
        <circle cx="55" cy="38" r="0.9" fill="#ffffff"/>
        <circle cx="69" cy="38" r="0.9" fill="#ffffff"/>
        <path d="M61,42 L58.6,45.5 L61,49.5 L63.4,45.5 Z" fill="${c.beak}"/>
    `;
}
