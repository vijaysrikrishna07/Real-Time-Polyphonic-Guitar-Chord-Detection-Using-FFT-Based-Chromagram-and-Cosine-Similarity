/**
 * FretboardMapper.js
 * Manages the Region of Interest (ROI) for the guitar neck on screen,
 * and maps pixel (x, y) coordinates → {string, fret} indices.
 *
 * Mirrors the Python guitar_mapper.py logic adapted for the web canvas.
 */

const STORAGE_KEY = 'guitarCoach_roi';

export class FretboardMapper {
    /**
     * ROI is defined in *canvas* pixel space (relative to video element).
     * @type {{ x: number, y: number, width: number, height: number }}
     */
    roi = null;

    /** Number of visible frets in the ROI */
    numFrets = 5;

    /** Whether the user is holding the guitar left-handed (neck pointing right) */
    isLeftHanded = false;

    constructor() {
        this._loadFromStorage();
    }

    // ── Storage ──────────────────────────────────────────────────────────────

    _loadFromStorage() {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) {
                const data = JSON.parse(saved);
                this.roi = data.roi;
                this.numFrets = data.numFrets ?? 5;
                this.isLeftHanded = data.isLeftHanded ?? false;
            }
        } catch {
            this.roi = null;
        }
    }

    saveToStorage() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            roi: this.roi,
            numFrets: this.numFrets,
            isLeftHanded: this.isLeftHanded,
        }));
    }

    clearStorage() {
        localStorage.removeItem(STORAGE_KEY);
        this.roi = null;
    }

    // ── ROI Helpers ──────────────────────────────────────────────────────────

    hasROI() {
        return this.roi !== null;
    }

    /**
     * Set the ROI from the calibration box dimensions.
     * All values are in canvas pixels (0..canvasWidth, 0..canvasHeight).
     */
    setROI({ x, y, width, height }) {
        this.roi = { x, y, width, height };
    }

    /**
     * Returns a default ROI given canvas dimensions (first-time / un-calibrated).
     */
    getDefaultROI(canvasW, canvasH) {
        return {
            x: canvasW * 0.1,
            y: canvasH * 0.15,
            width: canvasW * 0.8,
            height: canvasH * 0.55,
        };
    }

    // ── Mapping ──────────────────────────────────────────────────────────────

    /**
     * Check if a canvas point is inside the ROI.
     * NOTE: The video is mirrored (scaleX(-1)), so px comes in already
     * un-mirrored from the landmark (landmark.x * canvasW gives canvas-space
     * on the mirrored canvas; we flip it back here).
     */
    isInROI(px, py) {
        if (!this.roi) return false;
        const { x, y, width, height } = this.roi;
        return px >= x && px <= x + width && py >= y && py <= y + height;
    }

    /**
     * Map a canvas-space point to {string, fret}.
     * String 1 = high-e (top of fretboard in typical neck-up view),
     * Fret 1 = first fret (nearest headstock).
     *
     * @param {number} px - x in canvas pixels
     * @param {number} py - y in canvas pixels
     * @returns {{ string: number, fret: number }|null}
     */
    mapToFretboard(px, py) {
        if (!this.roi || !this.isInROI(px, py)) return null;

        const { x, y, width, height } = this.roi;

        const stringHeight = height / 6;
        const fretWidth = width / this.numFrets;

        // string 6 at top → index 6..1 (6=low E, 1=high e)
        const mappedYIndex = Math.floor((py - y) / stringHeight);
        const stringIndex = Math.max(1, 6 - mappedYIndex);

        // For right-handed players, headstock is on the LEFT of the screen (because of scaleX(-1)).
        // So fret 1 is at large canvas x (right side of ROI).
        // For left-handed players, headstock is on the RIGHT of the screen.
        // So fret 1 is at small canvas x (left side of ROI).
        const rawFretIdx = Math.floor((px - x) / fretWidth);

        // If left-handed, fret 1 is rawFretIdx 0 + 1 => 1. Body is at numFrets.
        // If right-handed, fret 1 is numFrets - rawFretIdx.
        const fretIndex = this.isLeftHanded
            ? Math.max(1, Math.min(this.numFrets, rawFretIdx + 1))
            : Math.max(1, this.numFrets - rawFretIdx);

        return { string: stringIndex, fret: fretIndex };
    }

    /**
     * Get the pixel center of a given {string, fret} position inside the ROI.
     * Useful for drawing target dots.
     */
    getFretboardPixel(stringNum, fretNum) {
        if (!this.roi) return null;
        const { x, y, width, height } = this.roi;

        const stringHeight = height / 6;
        const fretWidth = width / this.numFrets;

        // fret 1 (headstock) is at the RIGHT edge of the ROI canvas region for right-handed.
        // For left-handed, fret 1 is at the LEFT edge of the ROI.
        let cx;
        if (this.isLeftHanded) {
            cx = x + (fretNum - 1) * fretWidth + fretWidth / 2;
        } else {
            cx = x + (this.numFrets - fretNum) * fretWidth + fretWidth / 2;
        }

        // Invert Y calculation: if stringNum = 6, it should be at the top (index 0)
        // If stringNum = 1, it should be at the bottom (index 5)
        const stringYIndex = 6 - stringNum;
        const cy = y + stringYIndex * stringHeight + stringHeight / 2;

        return { cx, cy };
    }

    // ── Grid lines ───────────────────────────────────────────────────────────

    /**
     * Returns arrays of line segments for the fretboard grid.
     */
    getGridLines() {
        if (!this.roi) return { strings: [], frets: [] };
        const { x, y, width, height } = this.roi;

        const strings = [];
        for (let i = 1; i < 6; i++) {
            const ly = y + i * (height / 6);
            strings.push({ x1: x, y1: ly, x2: x + width, y2: ly });
        }

        const frets = [];
        for (let i = 1; i < this.numFrets; i++) {
            const lx = x + i * (width / this.numFrets);
            frets.push({ x1: lx, y1: y, x2: lx, y2: y + height });
        }

        return { strings, frets };
    }
}
