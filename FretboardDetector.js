/**
 * FretboardDetector.js — v2 (improved anti-false-detection)
 * ─────────────────────────────────────────────────────────────────────────────
 * Detects the guitar fretboard ROI from a live video frame using multi-factor
 * classical computer vision.  No external libraries required.
 *
 * Coordinate note:
 *   We analyse the RAW (un-mirrored) camera frame.
 *   Both the canvas overlay and the video element have CSS `transform: scaleX(-1)`
 *   applied, so they flip together and the ROI stays aligned with the dots.
 *
 * String rows:   top of ROI = string 6 (low E), bottom = string 1 (high e)
 * Fret columns:  left of ROI (raw camera) = headstock side; after CSS mirror
 *                the headstock appears on the RIGHT of the screen as expected.
 */

export class FretboardDetector {
    /**
     * @param {object} opts
     * @param {number} [opts.sampleW=320]        width of internal analysis canvas
     * @param {number} [opts.sampleH=240]        height of internal analysis canvas
     * @param {number} [opts.edgeThreshold=22]   Sobel magnitude cut-off
     * @param {number} [opts.minRunFrac=0.22]    min fraction of row width for a continuous edge run
     * @param {number} [opts.minWoodFrac=0.08]   min fraction of wood-hue pixels required per row
     * @param {number} [opts.minAspect=1.8]      minimum width/height ratio for the final ROI
     */
    constructor(opts = {}) {
        this._sW = opts.sampleW ?? 320;
        this._sH = opts.sampleH ?? 240;
        this._edgeT = opts.edgeThreshold ?? 22;
        this._minRunFrac = opts.minRunFrac ?? 0.22;
        this._minWoodFrac = opts.minWoodFrac ?? 0.08;
        this._minAspect = opts.minAspect ?? 1.8;

        this._canvas = document.createElement('canvas');
        this._canvas.width = this._sW;
        this._canvas.height = this._sH;
        this._ctx = this._canvas.getContext('2d', { willReadFrequently: true });
    }

    // ── Public API ────────────────────────────────────────────────────────────

    /**
     * Analyse one video frame and return an ROI, or null on failure.
     *
     * @param {HTMLVideoElement} video
     * @param {number} outW            - target canvas width  (ROI in this space)
     * @param {number} outH            - target canvas height
     * @param {Array|null} [handLandmarks] - MediaPipe hand landmark array (21 {x,y,z})
     *        landmark.x/y are in raw camera space 0-1.
     * @returns {{ x, y, width, height }|null}
     */
    detect(video, outW, outH, handLandmarks = null) {
        if (!video || video.readyState < 2) return null;

        const ctx = this._ctx;
        const sW = this._sW, sH = this._sH;

        // ── Draw RAW (un-mirrored) camera frame ───────────────────────────────
        // IMPORTANT: do NOT mirror here. The canvas overlay and video are both
        // CSS-flipped with scaleX(-1), so raw-camera coordinates work directly
        // as canvas coordinates. A second mirror here would cause a double-flip
        // that shifts the ROI to the wrong side of the screen.
        ctx.drawImage(video, 0, 0, sW, sH);

        const imgData = ctx.getImageData(0, 0, sW, sH);
        const data = imgData.data;

        // ── A. Build grayscale + wood-colour mask ─────────────────────────────
        const gray = new Uint8Array(sW * sH);
        const woodMask = new Uint8Array(sW * sH);

        for (let i = 0; i < sW * sH; i++) {
            const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
            gray[i] = (77 * r + 150 * g + 29 * b) >> 8;

            // Guitar necks: warm brown/tan/mahogany range
            const bright = r > 45 && r < 230;
            const warm = r >= g * 0.80;
            const notBlue = r > b * 1.05;
            const notGrey = Math.abs(r - g) + Math.abs(g - b) > 12;

            woodMask[i] = (bright && warm && notBlue && notGrey) ? 1 : 0;
        }

        // ── B. Vertical Sobel → horizontal edges (strings) ───────────────────
        const edges = new Uint8Array(sW * sH);
        for (let y = 1; y < sH - 1; y++) {
            for (let x = 1; x < sW - 1; x++) {
                const tl = gray[(y - 1) * sW + x - 1], t = gray[(y - 1) * sW + x], tr = gray[(y - 1) * sW + x + 1];
                const bl = gray[(y + 1) * sW + x - 1], b = gray[(y + 1) * sW + x], br = gray[(y + 1) * sW + x + 1];
                edges[y * sW + x] = Math.min(255, Math.abs(tl + 2 * t + tr - bl - 2 * b - br));
            }
        }

        // ── C. Row scoring: edge density + run-length + wood fraction ─────────
        const rowScore = new Float32Array(sH);

        const EDGE_T = this._edgeT;
        const MIN_RUN = Math.round(sW * this._minRunFrac);

        for (let y = 0; y < sH; y++) {
            let edgeCnt = 0, woodCnt = 0, maxRun = 0, run = 0;
            for (let x = 0; x < sW; x++) {
                const e = edges[y * sW + x] > EDGE_T;
                if (e) { edgeCnt++; run++; maxRun = Math.max(maxRun, run); } else { run = 0; }
                if (woodMask[y * sW + x]) woodCnt++;
            }

            const density = edgeCnt / sW;
            const runSpans = maxRun >= MIN_RUN;
            const hasWood = woodCnt / sW >= this._minWoodFrac;

            if (density >= 0.04 && runSpans) {
                const woodBoost = hasWood ? 1.5 : 0.6;
                rowScore[y] = density * (maxRun / sW) * woodBoost;
            }
        }

        // ── D. Hand-guided vertical search window ─────────────────────────────
        // landmark.x/y are normalised 0-1 in RAW camera space — same as here.
        let searchTop = 0, searchBot = sH;
        if (handLandmarks && handLandmarks.length >= 9) {
            const wrist = handLandmarks[0];
            const mcp = handLandmarks[9];
            const handCY = ((wrist.y + mcp.y) / 2) * sH;
            const R = sH * 0.40;
            searchTop = Math.max(0, Math.round(handCY - R));
            searchBot = Math.min(sH, Math.round(handCY + R));
        }

        // ── E. Slide window → find best vertical band ─────────────────────────
        const minWH = Math.max(10, Math.round((searchBot - searchTop) * 0.12));
        const maxWH = Math.round((searchBot - searchTop) * 0.70);

        let bestScore = 0, bestTop = searchTop, bestWinH = Math.round(sH * 0.3);

        for (let winH = minWH; winH <= maxWH; winH += 3) {
            for (let top = searchTop; top + winH <= searchBot; top++) {
                let score = 0, qualRows = 0;
                for (let r = top; r < top + winH; r++) {
                    if (rowScore[r] > 0) { score += rowScore[r]; qualRows++; }
                }
                score *= (qualRows / winH);

                // Periodicity bonus
                if (qualRows >= 3) {
                    const spacing = winH / qualRows;
                    let periodicBonus = 0;
                    for (let r = top + 1; r < top + winH; r++) {
                        if (rowScore[r] > 0 && rowScore[r - Math.round(spacing)] > 0) {
                            periodicBonus += 0.05;
                        }
                    }
                    score += periodicBonus;
                }

                if (score > bestScore) { bestScore = score; bestTop = top; bestWinH = winH; }
            }
        }

        if (bestScore < 0.003) return null;

        const detTop = bestTop;
        const detBot = bestTop + bestWinH;

        // ── F. Horizontal extent via column energy in the detected band ────────
        const colEnergy = new Float32Array(sW);
        for (let x = 0; x < sW; x++) {
            let s = 0;
            for (let y = detTop; y < detBot; y++) s += edges[y * sW + x];
            colEnergy[x] = s;
        }

        const smooth = new Float32Array(sW);
        const k = 10;
        for (let x = k; x < sW - k; x++) {
            let s = 0;
            for (let dx = -k; dx <= k; dx++) s += colEnergy[x + dx];
            smooth[x] = s / (2 * k + 1);
        }

        const maxCol = Math.max(...smooth);
        const colThresh = maxCol * 0.32;
        let leftCol = 0, rightCol = sW - 1;
        for (let x = 0; x < sW; x++) { if (smooth[x] >= colThresh) { leftCol = x; break; } }
        for (let x = sW - 1; x >= 0; x--) { if (smooth[x] >= colThresh) { rightCol = x; break; } }

        // ── G. Aspect-ratio guard ─────────────────────────────────────────────
        const detW = rightCol - leftCol;
        const detH = detBot - detTop;

        if (detW < detH * this._minAspect) {
            const need = Math.round(detH * this._minAspect);
            const extra = Math.round((need - detW) / 2);
            leftCol = Math.max(0, leftCol - extra);
            rightCol = Math.min(sW - 1, rightCol + extra);
        }

        if (rightCol - leftCol < sW * 0.25) return null;

        // ── H. Add margin and scale to output canvas space ────────────────────
        const mX = Math.round(sW * 0.015);
        const mY = Math.round(sH * 0.015);
        const scX = outW / sW, scY = outH / sH;

        return {
            x: Math.max(0, (leftCol - mX)) * scX,
            y: Math.max(0, (detTop - mY)) * scY,
            width: Math.min(sW, (rightCol - leftCol + 2 * mX)) * scX,
            height: Math.min(sH, (detH + 2 * mY)) * scY,
        };
    }
}
