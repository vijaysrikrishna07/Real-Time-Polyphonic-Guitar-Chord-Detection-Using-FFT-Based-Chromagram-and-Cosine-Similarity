/**
 * OverlayRenderer.js
 * Draws all visual overlays onto the canvas:
 *   - Fretboard grid (ROI rectangle + string/fret lines)
 *   - Target chord dots (green ghost circles)
 *   - Detected fingertip dots (red/green based on correctness)
 *   - All hand landmarks (subtle skeleton)
 *   - Match score text
 */

export class OverlayRenderer {
    /** @type {HTMLCanvasElement} */
    _canvas = null;
    /** @type {CanvasRenderingContext2D} */
    _ctx = null;

    constructor(canvas) {
        this._canvas = canvas;
        this._ctx = canvas.getContext('2d');
    }

    /** Resize canvas to match video element's display size */
    syncSize(videoElement) {
        const rect = videoElement.getBoundingClientRect();
        this._canvas.width = rect.width;
        this._canvas.height = rect.height;
    }

    /** Clear the full canvas */
    clear() {
        this._ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
    }

    // ── Fretboard Grid ──────────────────────────────────────────────────────

    /**
     * Draw the ROI rectangle and string/fret grid lines.
     * @param {{ x,y,width,height }} roi
     * @param {{ strings: [], frets: [] }} gridLines
     * @param {boolean} isOutOfBounds
     */
    drawFretboardGrid(roi, gridLines, isOutOfBounds = false) {
        const ctx = this._ctx;
        const colorBorder = isOutOfBounds ? 'rgba(239, 68, 68, 0.9)' : 'rgba(79, 156, 249, 0.7)';
        const colorStrings = isOutOfBounds ? 'rgba(239, 68, 68, 0.4)' : 'rgba(255, 200, 100, 0.35)';

        // ROI border
        ctx.save();
        ctx.strokeStyle = colorBorder;
        ctx.lineWidth = isOutOfBounds ? 4 : 2;
        ctx.setLineDash([6, 4]);
        ctx.strokeRect(roi.x, roi.y, roi.width, roi.height);
        ctx.restore();

        // String lines (horizontal)
        ctx.save();
        ctx.strokeStyle = colorStrings;
        ctx.lineWidth = 1;
        for (const l of gridLines.strings) {
            ctx.beginPath();
            ctx.moveTo(l.x1, l.y1);
            ctx.lineTo(l.x2, l.y2);
            ctx.stroke();
        }
        ctx.restore();

        // Fret lines (vertical)
        ctx.save();
        ctx.strokeStyle = 'rgba(150, 150, 200, 0.3)';
        ctx.lineWidth = 1;
        for (const l of gridLines.frets) {
            ctx.beginPath();
            ctx.moveTo(l.x1, l.y1);
            ctx.lineTo(l.x2, l.y2);
            ctx.stroke();
        }
        ctx.restore();
    }

    // ── Chord Target Dots ────────────────────────────────────────────────────

    /**
     * Draw semi-transparent target dots for the current chord shape.
     * @param {Array<{cx:number, cy:number}>} targetPositions
     */
    drawTargetDots(targetPositions) {
        const ctx = this._ctx;
        for (const pos of targetPositions) {
            if (!pos) continue;
            // Outer glow
            const grad = ctx.createRadialGradient(pos.cx, pos.cy, 2, pos.cx, pos.cy, 16);
            grad.addColorStop(0, 'rgba(45, 212, 160, 0.55)');
            grad.addColorStop(1, 'rgba(45, 212, 160, 0)');
            ctx.save();
            ctx.beginPath();
            ctx.arc(pos.cx, pos.cy, 16, 0, Math.PI * 2);
            ctx.fillStyle = grad;
            ctx.fill();
            ctx.restore();

            // Inner circle
            ctx.save();
            ctx.beginPath();
            ctx.arc(pos.cx, pos.cy, 10, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(45, 212, 160, 0.25)';
            ctx.strokeStyle = 'rgba(45, 212, 160, 0.8)';
            ctx.lineWidth = 2;
            ctx.fill();
            ctx.stroke();
            ctx.restore();
        }
    }

    // ── Fingertip Dots ───────────────────────────────────────────────────────

    /**
     * Draw detected fingertip dots, colored by correctness.
     * @param {Array<{cx:number, cy:number, correct: boolean, inROI: boolean}>} tips
     */
    drawFingertipDots(tips) {
        const ctx = this._ctx;
        for (const tip of tips) {
            const color = tip.inROI
                ? (tip.correct ? '#2dd4a0' : '#f97066')
                : 'rgba(200, 200, 200, 0.5)';
            const glowColor = tip.inROI
                ? (tip.correct ? 'rgba(45,212,160,0.5)' : 'rgba(249,112,102,0.5)')
                : 'rgba(200,200,200,0.2)';

            // Glow
            ctx.save();
            ctx.shadowColor = glowColor;
            ctx.shadowBlur = 12;
            ctx.beginPath();
            ctx.arc(tip.cx, tip.cy, 10, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();
            ctx.restore();

            // White ring
            ctx.save();
            ctx.beginPath();
            ctx.arc(tip.cx, tip.cy, 10, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(255,255,255,0.5)';
            ctx.lineWidth = 1.5;
            ctx.stroke();
            ctx.restore();
        }
    }

    // ── Hand Skeleton ────────────────────────────────────────────────────────

    /**
     * Draw the full 21-landmark hand skeleton.
     * @param {Array<{x,y}>} landmarks - normalized 0..1 coords
     * @param {number} canvasW
     * @param {number} canvasH
     */
    drawHandSkeleton(landmarks, canvasW, canvasH) {
        if (!landmarks) return;
        const ctx = this._ctx;

        // Connection pairs (MediaPipe hand topology)
        const connections = [
            [0, 1], [1, 2], [2, 3], [3, 4],
            [0, 5], [5, 6], [6, 7], [7, 8],
            [0, 9], [9, 10], [10, 11], [11, 12],
            [0, 13], [13, 14], [14, 15], [15, 16],
            [0, 17], [17, 18], [18, 19], [19, 20],
            [5, 9], [9, 13], [13, 17],
        ];

        const pts = landmarks.map(l => ({
            x: l.x * canvasW,
            y: l.y * canvasH,
        }));

        ctx.save();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.lineWidth = 1.5;
        for (const [a, b] of connections) {
            ctx.beginPath();
            ctx.moveTo(pts[a].x, pts[a].y);
            ctx.lineTo(pts[b].x, pts[b].y);
            ctx.stroke();
        }

        // Joint dots
        for (const pt of pts) {
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, 3, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
            ctx.fill();
        }
        ctx.restore();
    }

    // ── Score Overlay ─────────────────────────────────────────────────────────

    /**
     * Draw score text in top-right of ROI.
     * @param {{ score: number, total: number }} result
     * @param {{ x,y,width,height }} roi
     */
    drawScoreOverlay(result, roi) {
        if (!result || result.total === 0) return;
        const ctx = this._ctx;
        const pct = Math.round((result.score / result.total) * 100);
        const color = pct >= 80 ? '#2dd4a0' : pct >= 50 ? '#fbbf24' : '#f97066';
        const text = `${result.score}/${result.total} correct`;

        ctx.save();
        ctx.font = 'bold 13px Inter, sans-serif';
        ctx.fillStyle = color;
        ctx.textAlign = 'right';
        ctx.shadowColor = color;
        ctx.shadowBlur = 8;

        // Counter the CSS transform: scaleX(-1) on the canvas
        // so that the text isn't drawn backwards
        ctx.scale(-1, 1);

        // Because of the scale(-1, 1), the x-coordinate must be flipped
        // and we draw it at the negated X coordinate
        ctx.fillText(text, -(roi.x + roi.width - 8), roi.y + 20);
        ctx.restore();
    }
}
