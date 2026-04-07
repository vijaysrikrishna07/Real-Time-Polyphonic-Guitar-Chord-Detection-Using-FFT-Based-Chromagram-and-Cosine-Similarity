/**
 * PracticeSession.js
 *
 * Manages the timed multi-chord practice session:
 *   Em → C → G → D
 *
 * Emits events via callback props:
 *   onTick(remaining, elapsed)          — every second
 *   onChordChange(chord, index)         — when target chord advances
 *   onCorrect(chord, nextChord, index)  — chord matched successfully
 *   onComplete(stats)                   — session finished
 */

export const DEFAULT_CHORD_SEQUENCE = ['Em', 'C', 'G', 'D'];

export class PracticeSession {
    /**
     * @param {object} opts
     * @param {number}   opts.duration         — total session seconds (default 30)
     * @param {string[]} opts.chordSequence     — ordered list of chord names
     * @param {number}   opts.minHoldMs         — ms chord must be continuously heard (default 400)
     */
    constructor({ duration = 30, chordSequence = DEFAULT_CHORD_SEQUENCE, minHoldMs = 400 } = {}) {
        this.duration = duration;
        this.chordSequence = chordSequence;
        this.minHoldMs = minHoldMs;

        // ── Event hooks ────────────────────────────────────────────────────────
        /** @type {function(number, number): void} */
        this.onTick = null;
        /** @type {function(string, number): void} */
        this.onChordChange = null;
        /** @type {function(string, string|null, number): void} */
        this.onCorrect = null;
        /** @type {function({chordsCompleted, total, elapsed}): void} */
        this.onComplete = null;

        // ── Internal state ─────────────────────────────────────────────────────
        this._active = false;
        this._startTime = null;
        this._timerId = null;
        this._currentIndex = 0;
        this._chordsCompleted = 0;
        this._holdStart = null;   // when current match streak began
        this._lastChord = null;   // last confirmed chord from detector
    }

    // ── Public API ─────────────────────────────────────────────────────────────

    get isActive() { return this._active; }
    get currentChord() { return this.chordSequence[this._currentIndex] ?? null; }
    get currentIndex() { return this._currentIndex; }
    get chordsCompleted() { return this._chordsCompleted; }
    get elapsed() { return this._startTime ? (Date.now() - this._startTime) / 1000 : 0; }
    get remaining() { return Math.max(0, this.duration - this.elapsed); }

    /** Start the session timer. */
    start() {
        if (this._active) return;
        this._active = true;
        this._startTime = Date.now();
        this._currentIndex = 0;
        this._chordsCompleted = 0;
        this._holdStart = null;
        this._lastChord = null;

        // Emit initial chord
        if (this.onChordChange) this.onChordChange(this.currentChord, 0);

        // Tick every second
        this._timerId = setInterval(() => this._tick(), 1000);
    }

    /** Stop the session early. */
    stop() {
        if (!this._active) return;
        this._finalise();
    }

    /**
     * Feed an audio detection result into the session.
     * Called by the AudioChordDetector callback in main.js.
     *
     * @param {{ status: string, chord: string|null }} result
     */
    onDetection(result) {
        if (!this._active) return;

        const { status, chord } = result;

        if (status === 'silent' || !chord) {
            this._holdStart = null;
            this._lastChord = null;
            return;
        }

        const target = this.currentChord;
        if (!target) return;

        if (chord.toLowerCase() === target.toLowerCase()) {
            // Correct chord — start or continue hold timer
            if (this._lastChord?.toLowerCase() !== chord.toLowerCase()) {
                this._holdStart = Date.now();
                this._lastChord = chord;
            }

            const heldMs = Date.now() - (this._holdStart ?? Date.now());
            if (heldMs >= this.minHoldMs) {
                this._advanceChord();
            }
        } else {
            // Wrong chord — reset hold
            this._holdStart = null;
            this._lastChord = chord;
        }
    }

    // ── Internal ───────────────────────────────────────────────────────────────

    _tick() {
        if (!this._active) return;
        if (this.onTick) this.onTick(this.remaining, this.elapsed);
        if (this.remaining <= 0) this._finalise();
    }

    _advanceChord() {
        const completedChord = this.currentChord;
        this._chordsCompleted++;
        this._currentIndex++;
        this._holdStart = null;
        this._lastChord = null;

        const nextChord = this.currentChord; // may be null if sequence exhausted

        if (this.onCorrect) this.onCorrect(completedChord, nextChord, this._currentIndex - 1);

        if (!nextChord) {
            // All chords done — end session
            this._finalise();
            return;
        }

        if (this.onChordChange) this.onChordChange(nextChord, this._currentIndex);
    }

    _finalise() {
        if (!this._active) return;
        this._active = false;
        clearInterval(this._timerId);
        this._timerId = null;

        if (this.onComplete) {
            this.onComplete({
                chordsCompleted: this._chordsCompleted,
                total: this.chordSequence.length,
                elapsed: this.elapsed,
            });
        }
    }
}
