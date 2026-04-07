/**
 * ChordModel.js — v2
 * Loads the 35-chord dataset (chords.json) and exposes helpers
 * compatible with both the existing main.js API and the extended
 * dataset API described in DATASET_INTEGRATION.md.
 *
 * String index convention (matches chords.json):
 *   0 = E2 (low E / thickest)   → displayed at TOP of ROI
 *   5 = E4 (high e / thinnest)  → displayed at BOTTOM of ROI
 *
 * Fret values:  'x' = muted,  0 = open,  N = fret number
 * Finger codes: 0 = none, 1 = index, 2 = middle, 3 = ring, 4 = pinky
 */

import CHORD_DATA from './chords.json';

// ── Internal indexes built once on module load ────────────────────────────────

const _chordMap = new Map();   // id  → chord object
const _nameIndex = new Map();   // name (lower) → [chord, …]

for (const chord of CHORD_DATA.chords) {
    _chordMap.set(chord.id, chord);
    const key = chord.name.toLowerCase();
    if (!_nameIndex.has(key)) _nameIndex.set(key, []);
    _nameIndex.get(key).push(chord);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Convert chords.json fret value ('x'|0|N) to the legacy -1/0/N format */
function _normFret(v) {
    if (v === 'x') return -1;
    return v;
}

/** Build a legacy 6-element fret array from a chord object */
function _toLegacyShape(chord) {
    return chord.strings.map(_normFret);
}

// ── Public class (keeps the same API as ChordModel v1) ───────────────────────

export class ChordModel {
    constructor() {
        this._currentChordName = null;
        this._currentChordObj = null;
    }

    // ── Legacy API (used by existing main.js) ─────────────────────────────────

    /** Sorted list of unique chord names available in the dataset */
    get availableChords() {
        return [..._nameIndex.keys()]
            .map(k => _nameIndex.get(k)[0].name)
            .sort();
    }

    /**
     * Returns a 6-element array [E2..E4] with fret numbers
     * (-1 = muted, 0 = open, N = fret) for the given chord name.
     */
    getChordShape(chordName) {
        if (!chordName) return null;
        const variants = _nameIndex.get(chordName.toLowerCase()) ?? [];
        if (!variants.length) return null;
        return _toLegacyShape(variants[0]);
    }

    setCurrentChord(name) {
        this._currentChordName = name || null;
        if (!name) { this._currentChordObj = null; return; }
        const variants = _nameIndex.get(name.toLowerCase()) ?? [];
        this._currentChordObj = variants[0] ?? null;
    }

    getCurrentChordShape() {
        if (!this._currentChordObj) return null;
        return _toLegacyShape(this._currentChordObj);
    }

    /**
     * Compare detected finger positions to the current chord.
     * @param {Array<{string:number, fret:number}|null>} detectedFingers
     * @returns {{ score, total, details, hints }}
     */
    compareFingers(detectedFingers) {
        const shape = this.getCurrentChordShape();
        if (!shape || !detectedFingers) return { score: 0, total: 0, details: [], hints: [] };

        const FINGER_NAMES = ['', 'index', 'middle', 'ring', 'pinky'];
        const STRING_NAMES = ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'];

        // chords.json: index 0 = string 6 (low E) at TOP of ROI → FretboardMapper
        // string number 6 → stringIndex in mapper = 6 - s, but mapper now stores
        // inverted (string 6 at top = position 0). We compare using the mapper's
        // string number  (6 = low E at top, 1 = high e at bottom).
        const fingerData = this._currentChordObj;
        const targets = [];
        for (let s = 0; s < 6; s++) {
            const fret = shape[s];
            if (fret > 0) {
                const mapperString = 6 - s;   // string 6 = low E = top of ROI
                targets.push({
                    string: mapperString,
                    fret,
                    finger: fingerData ? fingerData.fingers[s] : 0,
                    stringLabel: STRING_NAMES[s],
                });
            }
        }

        if (targets.length === 0) return { score: 0, total: 0, details: [], hints: [] };

        const TOLERANCE = 1; // Allow ±1 fret/string for real-world webcam jitter
        let correct = 0;
        const hints = [];
        const details = targets.map(target => {
            const hit = detectedFingers.some(f =>
                f && Math.abs(f.string - target.string) <= TOLERANCE &&
                Math.abs(f.fret - target.fret) <= TOLERANCE
            );
            if (hit) {
                correct++;
            } else {
                const finger = FINGER_NAMES[target.finger] || 'finger';
                const onString = detectedFingers.find(f => f && Math.abs(f.string - target.string) <= TOLERANCE);
                if (onString) {
                    const dir = onString.fret < target.fret ? 'away from nut ↑' : 'toward nut ↓';
                    hints.push(`Move your ${finger} on string ${target.stringLabel} ${dir} to fret ${target.fret}.`);
                } else {
                    hints.push(`Place your ${finger} on string ${target.stringLabel}, fret ${target.fret}.`);
                }
            }
            return { target, hit };
        });

        return { score: correct, total: targets.length, details, hints };
    }

    // ── Extended dataset API ──────────────────────────────────────────────────

    /** Get chord by its dataset ID (e.g. 'G_major_open') */
    getChordById(id) {
        return _chordMap.get(id) ?? null;
    }

    /** All variants for a chord name */
    getAllVariants(chordName) {
        return _nameIndex.get(chordName.toLowerCase()) ?? [];
    }

    /** Filter by difficulty: 'beginner' | 'intermediate' | 'advanced' */
    getChordsByDifficulty(level) {
        return CHORD_DATA.chords.filter(c => c.difficulty === level);
    }

    /** Filter by type: 'major' | 'minor' | 'dominant7' | 'major7' | 'minor7' | 'sus2' | 'sus4' | 'add9' */
    getChordsByType(type) {
        return CHORD_DATA.chords.filter(c => c.type === type);
    }

    /** Returns the 4 practice progressions defined in the dataset */
    getAllProgressions() {
        return CHORD_DATA.chordProgressions;
    }
}
