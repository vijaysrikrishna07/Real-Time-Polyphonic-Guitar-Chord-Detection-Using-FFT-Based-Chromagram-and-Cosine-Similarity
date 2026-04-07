/**
 * main.js — AppController
 * Coordinates all modules:
 *   VideoSource → HandTrackingService → FretboardMapper → ChordModel → OverlayRenderer
 * Also manages UI state, calibration, chord selection, and score display.
 */

import { VideoSource } from './VideoSource.js';
import { HandTrackingService } from './HandTrackingService.js';
import { FretboardMapper } from './FretboardMapper.js';
import { FretboardDetector } from './FretboardDetector.js';
import { ChordModel } from './ChordModel.js';
import { OverlayRenderer } from './OverlayRenderer.js';
import { TunedChordDetector, CHORD_NOTES, CHORD_DISPLAY_NAMES } from './TunedChordDetector.js';
import { PracticeSession, DEFAULT_CHORD_SEQUENCE } from './PracticeSession.js';
import { ChatbotService } from './ChatbotService.js';

// ── DOM Refs ────────────────────────────────────────────────────────────────

const video = document.getElementById('webcamVideo');
const canvas = document.getElementById('overlayCanvas');
const placeholder = document.getElementById('videoPlaceholder');
const calibBox = document.getElementById('calibrationBox');
const hintText = document.getElementById('hintText');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const scoreCircle = document.getElementById('scoreCircle');
const scoreNumber = document.getElementById('scoreNumber');
const scoreLabel = document.getElementById('scoreLabel');
const fingerStatus = document.getElementById('fingerStatus');
const chordChart = document.getElementById('chordChart');
const tipsList = document.getElementById('tipsList');

const btnStart = document.getElementById('btnStartCamera');
const btnStop = document.getElementById('btnStopCamera');
const btnCalibrate = document.getElementById('btnCalibrate');
const btnConfirm = document.getElementById('btnConfirmCalibration');
const btnCancel = document.getElementById('btnCancelCalibration');
const leftHandedToggle = document.getElementById('leftHandedToggle');
const chordSelect = document.getElementById('chordSelect');

// ── Practice Session DOM refs ───────────────────────────────────────────────
const btnStartMic = document.getElementById('btnStartMic');
const btnStopMic = document.getElementById('btnStopMic');
const audioResult = document.getElementById('audioResult');
const audioResultIcon = document.getElementById('audioResultIcon');
const audioResultText = document.getElementById('audioResultText');
const detectedNotes = document.getElementById('detectedNotes');
const audioMeter = document.getElementById('audioMeter');
const durationSelect = document.getElementById('durationSelect');
// Countdown ring
const cdFill = document.getElementById('cdFill');
const cdTime = document.getElementById('cdTime');
const cdIcon = document.getElementById('cdIcon');
// Target chord
const targetCard = document.getElementById('targetCard');
const targetChordName = document.getElementById('targetChordName');
const targetChordFull = document.getElementById('targetChordFull');
// Pipeline
const chordPipeline = document.getElementById('chordPipeline');
// Detection banner
const detectBanner = document.getElementById('detectBanner');
const detectIcon = document.getElementById('detectIcon');
const detectChordName = document.getElementById('detectChordName');
const detectChordDetail = document.getElementById('detectChordDetail');
const detectBar = document.getElementById('detectBar');
// Stats
const statChords = document.getElementById('statChords');
const statTime = document.getElementById('statTime');
const statElapsed = document.getElementById('statElapsed');
const statAccuracy = document.getElementById('statAccuracy');
// Session complete
const sessionComplete = document.getElementById('sessionComplete');
const completeDetail = document.getElementById('completeDetail');

// ── Free Play DOM refs ───────────────────────────────────────────────────────
const btnStartFreePlay = document.getElementById('btnStartFreePlay');
const btnStopFreePlay = document.getElementById('btnStopFreePlay');
const freePlayCard = document.getElementById('freePlayCard');
const freePlayLabel = document.getElementById('freePlayLabel');
const freePlayChordName = document.getElementById('freePlayChordName');
const freePlayChordFull = document.getElementById('freePlayChordFull');
const freePlayNotes = document.getElementById('freePlayNotes');

// ── Gemini Chatbot DOM refs ──────────────────────────────────────────────────
const chatbotWidget = document.getElementById('chatbotWidget');
const chatbotToggleBtn = document.getElementById('chatbotToggleBtn');
const chatbotCloseBtn = document.getElementById('chatbotCloseBtn');
const chatbotMessages = document.getElementById('chatbotMessages');
const chatbotInput = document.getElementById('chatbotInput');
const chatbotSendBtn = document.getElementById('chatbotSendBtn');

// ── Module instances ─────────────────────────────────────────────────────────

const videoSource = new VideoSource(video);
const handTracker = new HandTrackingService();
const fretDetector = new FretboardDetector();
const fretMapper = new FretboardMapper();
const chordModel = new ChordModel();
const renderer = new OverlayRenderer(canvas);
const audioDetector = new TunedChordDetector(); // Switched to DSP math engine
const chatbotService = new ChatbotService();
let practiceSession = null;

// ── State ──────────────────────────────────────────────────────────────────

let isRunning = false;
let isCalibrating = false;
let rafId = null;
let modelLoading = false;
let lastHandLandmarks = null;   // updated every render frame
let isLeftHanded = false;

// ── Status helpers ─────────────────────────────────────────────────────────

function setStatus(text, type = 'idle') {
    statusText.textContent = text;
    statusDot.className = 'status-dot' + (type === 'active' ? ' active' : type === 'error' ? ' error' : '');
}

function setHint(text) {
    hintText.textContent = text;
}

// ── Score UI ────────────────────────────────────────────────────────────────

const CIRCUMFERENCE = 2 * Math.PI * 42; // circle r=42

function updateScoreUI(result) {
    if (!result || result.total === 0) {
        scoreNumber.textContent = '—';
        const hasChord = chordSelect && chordSelect.value;
        if (!hasChord) {
            scoreLabel.textContent = 'No chord selected';
        } else if (!isRunning) {
            scoreLabel.textContent = 'Start camera to detect';
        } else {
            scoreLabel.textContent = 'Hold chord in ROI';
        }
        scoreCircle.style.strokeDashoffset = CIRCUMFERENCE;
        scoreCircle.style.stroke = 'var(--text-muted)';
        fingerStatus.innerHTML = '';
        return;
    }

    const pct = result.score / result.total;
    const offset = CIRCUMFERENCE * (1 - pct);
    const color = pct >= 0.8 ? 'var(--success)' : pct >= 0.5 ? 'var(--warning)' : 'var(--danger)';

    scoreCircle.style.strokeDashoffset = offset;
    scoreCircle.style.stroke = color;
    scoreNumber.textContent = `${Math.round(pct * 100)}%`;
    scoreLabel.textContent = `${result.score} / ${result.total} fingers correct`;

    // Finger badges
    fingerStatus.innerHTML = result.details.map((d, i) =>
        `<span class="finger-badge ${d.hit ? 'correct' : 'incorrect'}">
      ${['Thumb', 'Idx', 'Mid', 'Ring', 'Pink'][i] ?? `F${i + 1}`}
    </span>`
    ).join('');
}

// ── Chord Chart panel ───────────────────────────────────────────────────────

const STRING_LABELS = ['6', '5', '4', '3', '2', '1'];

function renderChordChart(chordName) {
    const shape = chordModel.getChordShape(chordName);
    if (!shape) {
        chordChart.innerHTML = '<p class="hint-text">Select a chord to see its fingering chart.</p>';
        return;
    }

    const rows = STRING_LABELS.map((lbl, i) => {
        const fret = shape[i];
        const indicator = fret === -1 ? '✕' : fret === 0 ? 'O' : `${fret}`;
        const cls = fret === -1 ? 'muted' : fret === 0 ? 'open' : 'fret';
        return `<div class="chart-row">
      <span class="chart-string">${lbl}</span>
      <span class="chart-fret ${cls}">${indicator}</span>
    </div>`;
    }).join('');

    chordChart.innerHTML = `
    <div class="chord-name-label">${chordName}</div>
    <div class="chart-grid">${rows}</div>
    <div class="chord-frets-label">Lo ← strings → Hi</div>
  `;
}

// ── Calibration UI ──────────────────────────────────────────────────────────

function startCalibration() {
    isCalibrating = true;
    calibBox.classList.remove('hidden');
    btnCalibrate.classList.add('hidden');
    btnConfirm.classList.remove('hidden');
    btnCancel.classList.remove('hidden');
    setHint('📐 Drag to align the blue box with your guitar neck, then click Confirm.');
    makeDraggableResizable(calibBox);
}

function confirmCalibration() {
    const wrapper = document.getElementById('videoWrapper');
    const wRect = wrapper.getBoundingClientRect();
    const bRect = calibBox.getBoundingClientRect();

    // Convert to canvas-relative coordinates
    const scaleX = canvas.width / wRect.width;
    const scaleY = canvas.height / wRect.height;

    // Because video is mirrored (scaleX(-1)), flip the x coordinate
    const x = (wRect.width - (bRect.left - wRect.left) - bRect.width) * scaleX;
    const y = (bRect.top - wRect.top) * scaleY;

    fretMapper.setROI({
        x,
        y,
        width: bRect.width * scaleX,
        height: bRect.height * scaleY,
    });
    fretMapper.saveToStorage();

    endCalibration();
    setHint('✅ Calibration saved! Now select a chord and start playing.');
}

function endCalibration() {
    isCalibrating = false;
    calibBox.classList.add('hidden');
    btnCalibrate.classList.remove('hidden');
    btnConfirm.classList.add('hidden');
    btnCancel.classList.add('hidden');
}

// ── Drag + Resize calibration box ──────────────────────────────────────────

function makeDraggableResizable(el) {
    const corners = el.querySelectorAll('.calib-corner');
    let action = null, startX, startY, startRect;

    const getRect = () => ({
        left: parseInt(el.style.left || el.offsetLeft),
        top: parseInt(el.style.top || el.offsetTop),
        width: el.offsetWidth,
        height: el.offsetHeight,
    });

    const onMove = (e) => {
        if (!action) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        const { left, top, width, height } = startRect;

        if (action === 'drag') {
            el.style.left = (left + dx) + 'px';
            el.style.top = (top + dy) + 'px';
        } else if (action === 'br') {
            el.style.width = Math.max(60, width + dx) + 'px';
            el.style.height = Math.max(40, height + dy) + 'px';
        } else if (action === 'bl') {
            el.style.left = (left + dx) + 'px';
            el.style.width = Math.max(60, width - dx) + 'px';
            el.style.height = Math.max(40, height + dy) + 'px';
        } else if (action === 'tr') {
            el.style.top = (top + dy) + 'px';
            el.style.width = Math.max(60, width + dx) + 'px';
            el.style.height = Math.max(40, height - dy) + 'px';
        } else if (action === 'tl') {
            el.style.left = (left + dx) + 'px';
            el.style.top = (top + dy) + 'px';
            el.style.width = Math.max(60, width - dx) + 'px';
            el.style.height = Math.max(40, height - dy) + 'px';
        }
    };

    const onUp = () => { action = null; };

    el.addEventListener('mousedown', (e) => {
        if (e.target.classList.contains('calib-corner')) return;
        e.preventDefault();
        action = 'drag'; startX = e.clientX; startY = e.clientY;
        startRect = getRect();
    });

    corners.forEach(c => {
        const type = [...c.classList].find(cl => ['tl', 'tr', 'bl', 'br'].includes(cl));
        c.addEventListener('mousedown', (e) => {
            e.preventDefault(); e.stopPropagation();
            action = type; startX = e.clientX; startY = e.clientY;
            startRect = getRect();
        });
    });

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
}

// ── Main render loop ─────────────────────────────────────────────────────────

async function renderLoop() {
    if (!isRunning) return;

    renderer.syncSize(video);
    renderer.clear();

    const cw = canvas.width;
    const ch = canvas.height;

    // Use saved ROI or set a default
    if (!fretMapper.hasROI()) {
        fretMapper.setROI(fretMapper.getDefaultROI(cw, ch));
    }

    const roi = fretMapper.roi;
    let isOutOfBounds = false;
    let outOfBoundsDirection = null;

    // Run hand detection first so FretboardDetector can use landmarks
    const landmarks = handTracker.detectForVideo(video, performance.now());
    let compareResult = null;
    let hand = null;

    if (landmarks && landmarks.length > 0) {
        hand = landmarks[0];
        lastHandLandmarks = hand;
    }

    // Check for Fretboard Drift
    if (!isCalibrating && fretMapper.hasROI() && (window.frameCounter || 0) % 3 === 0) {
        const liveBounds = fretDetector.detect(video, cw, ch, hand ? [hand] : null);
        if (liveBounds) {
            const calCX = roi.x + roi.width / 2;
            const calCY = roi.y + roi.height / 2;
            const liveCX = liveBounds.x + liveBounds.width / 2;
            const liveCY = liveBounds.y + liveBounds.height / 2;

            const driftX = calCX - liveCX; // Positive meaning the live guitar is to the Left of the calibrated box (due to mirror)
            const driftY = calCY - liveCY;

            if (Math.abs(driftX) > roi.width * 0.25 || Math.abs(driftY) > roi.height * 0.35) {
                isOutOfBounds = true;
                if (Math.abs(driftX) > Math.abs(driftY)) {
                    outOfBoundsDirection = driftX > 0 ? 'Move Guitar Left ⬅️' : 'Move Guitar Right ➡️';
                } else {
                    outOfBoundsDirection = driftY > 0 ? 'Move Guitar Up ⬆️' : 'Move Guitar Down ⬇️';
                }
            }
        }
    }
    window.frameCounter = (window.frameCounter || 0) + 1;

    // UI Update Warning
    const warningEl = document.getElementById('positionWarningOverlay');
    const warningText = document.getElementById('positionWarningText');
    if (warningEl && warningText) {
        if (isOutOfBounds) {
            warningText.textContent = outOfBoundsDirection;
            warningEl.classList.remove('hidden');
        } else {
            warningEl.classList.add('hidden');
        }
    }

    const grid = fretMapper.getGridLines();
    renderer.drawFretboardGrid(roi, grid, isOutOfBounds);

    // Draw target chord dots with labels (Only if NOT out of bounds)
    const shape = chordModel.getCurrentChordShape();
    const STRING_NAMES_MAP = ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'];
    if (shape && !isOutOfBounds) {
        const targetPositions = [];
        const targetLabels = [];
        for (let s = 0; s < 6; s++) {
            const fret = shape[s];
            if (fret > 0) {
                const stringNum = 6 - s;
                const pos = fretMapper.getFretboardPixel(stringNum, fret);
                if (pos) {
                    targetPositions.push(pos);
                    targetLabels.push(`${STRING_NAMES_MAP[s]} F${fret}`);
                }
            }
        }
        renderer.drawTargetDots(targetPositions);

        // Draw labels on target dots
        const ctx = canvas.getContext('2d');
        ctx.save();
        ctx.scale(-1, 1); // counter CSS mirror
        ctx.font = 'bold 12px Inter, sans-serif';
        ctx.fillStyle = 'rgba(45, 212, 160, 0.95)';
        ctx.textAlign = 'center';
        for (let i = 0; i < targetPositions.length; i++) {
            const pos = targetPositions[i];
            ctx.fillText(targetLabels[i], -pos.cx, pos.cy + 22);
        }
        ctx.restore();
    }

    if (hand && !isOutOfBounds) {
        // Draw skeleton
        renderer.drawHandSkeleton(hand, cw, ch);

        // Get fingertips
        const tips = handTracker.getFingertips(hand);
        const FINGER_NAMES = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'];

        // Map to fretboard coords
        const mappedFingers = tips.map(tip => {
            // Landmarks are normalized 0..1; convert to canvas pixels
            const px = tip.x * cw;
            const py = tip.y * ch;
            return fretMapper.mapToFretboard(px, py);
        });

        // Debug: log mapped finger positions (throttled to once per second)
        if (!window._lastDebugLog || performance.now() - window._lastDebugLog > 1000) {
            window._lastDebugLog = performance.now();
            const debugInfo = mappedFingers.map((m, i) =>
                m ? `${FINGER_NAMES[i]}: S${m.string} F${m.fret}` : `${FINGER_NAMES[i]}: outside ROI`
            );
            console.log('[Em Debug]', debugInfo.join(' | '));
        }

        // Compare to chord
        if (shape) {
            compareResult = chordModel.compareFingers(mappedFingers);
            renderer.drawScoreOverlay(compareResult, roi);
            // Show first actionable hint from the dataset
            if (compareResult && compareResult.hints && compareResult.hints.length > 0) {
                setHint('💡 ' + compareResult.hints[0]);
            } else if (compareResult && compareResult.total > 0 && compareResult.score === compareResult.total) {
                setHint('✅ Perfect! All fingers in position!');
            }
        }

        // Draw fingertip dots with debug labels
        const ctx = canvas.getContext('2d');
        const tipDots = tips.map((tip, i) => {
            const px = tip.x * cw;
            const py = tip.y * ch;
            const inROI = fretMapper.isInROI(px, py);
            const mapped = mappedFingers[i];
            const correct = compareResult && compareResult.details.some(d =>
                mapped && Math.abs(d.target.string - mapped.string) <= 1 &&
                Math.abs(d.target.fret - mapped.fret) <= 1 && d.hit
            );

            // Draw debug label showing string/fret next to each fingertip
            if (mapped) {
                ctx.save();
                ctx.scale(-1, 1); // counter the CSS mirror
                ctx.font = 'bold 11px Inter, sans-serif';
                ctx.fillStyle = correct ? '#2dd4a0' : '#fbbf24';
                ctx.fillText(`${FINGER_NAMES[i]}: S${mapped.string} F${mapped.fret}`, -(px + 14), py - 8);
                ctx.restore();
            }

            return { cx: px, cy: py, inROI, correct };
        });
        renderer.drawFingertipDots(tipDots);
    }

    updateScoreUI(compareResult);

    rafId = requestAnimationFrame(renderLoop);
}

// ── Camera ───────────────────────────────────────────────────────────────────

async function startCamera() {
    btnStart.disabled = true;
    setStatus('Starting camera…');
    setHint('📷 Requesting camera access…');

    const ok = await videoSource.start();
    if (!ok) {
        setStatus('Camera error', 'error');
        setHint('❌ Camera access denied. Please allow camera permissions and try again.');
        btnStart.disabled = false;
        return;
    }

    placeholder.classList.add('hidden');
    btnStart.disabled = true;
    btnStop.disabled = false;
    btnCalibrate.disabled = false;
    isRunning = true;
    setStatus('Camera active', 'active');
    setHint('🔄 Loading hand-tracking AI model…');

    // Load model (only once)
    if (!handTracker.isReady && !modelLoading) {
        modelLoading = true;
        await handTracker.init();
        modelLoading = false;
    }

    setHint('✅ Ready! Use Manual ROI to align the box with your guitar neck, then play Em.');
    rafId = requestAnimationFrame(renderLoop);
}

function stopCamera() {
    isRunning = false;
    lastHandLandmarks = null;
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    videoSource.stop();
    renderer.clear();
    placeholder.classList.remove('hidden');
    btnStart.disabled = false;
    btnStop.disabled = true;
    btnCalibrate.disabled = true;
    setStatus('Ready');
    setHint('📷 Click Start Camera to begin.');
    updateScoreUI(null);
}

// ── Multi-Chord Practice Session ─────────────────────────────────────────────

// Countdown ring circumference (r=58): 2π×58 ≈ 364.4
const CD_CIRCUMFERENCE = 364;

const meterBars = audioMeter ? Array.from(audioMeter.querySelectorAll('.meter-bar')) : [];
let meterRafId = null;

// Detection accuracy counters
let totalDetections = 0, correctDetections = 0;

// ── UI helpers ───────────────────────────────────────────────────────────────

function setAudioResult(state, icon, text) {
    audioResult.className = 'audio-result ' + state;
    audioResultIcon.textContent = icon;
    audioResultText.textContent = text;
}

function updateNoteChips(noteNames, targetChord) {
    const targetNotes = CHORD_NOTES[targetChord] ?? new Set();
    const unique = [...new Set(noteNames.filter(Boolean))];
    if (unique.length === 0) {
        detectedNotes.innerHTML = '<span class="note-chip muted">—</span>';
    } else {
        detectedNotes.innerHTML = unique.map(n => {
            const cls = targetNotes.has(n) ? 'em-note' : 'other-note';
            return `<span class="note-chip ${cls}">${n}</span>`;
        }).join('');
    }
}

/** Build / refresh the chord pipeline strip. */
function renderPipeline(sequence, doneIndex) {
    chordPipeline.innerHTML = sequence.map((chord, i) => {
        let state = 'pending';
        const sym = i < doneIndex ? '✓' : chord;
        if (i < doneIndex) state = 'done';
        else if (i === doneIndex) state = 'active';

        const arrow = i < sequence.length - 1
            ? '<span class="pip-arrow">›</span>'
            : '';

        return `
          <div class="chord-pip ${state}" role="listitem">
            <div class="pip-circle">${sym}</div>
            <span class="pip-label">${CHORD_DISPLAY_NAMES[chord] ?? chord}</span>
          </div>
          ${arrow}`;
    }).join('');
}

/** Update the countdown ring arc + timer text. */
function updateCountdownRing(remaining, total) {
    const fraction = total > 0 ? remaining / total : 1;
    const offset = CD_CIRCUMFERENCE * (1 - fraction);
    cdFill.style.strokeDashoffset = offset;

    // Colour changes as time runs low
    cdFill.classList.remove('warning', 'danger');
    if (fraction <= 0.25) cdFill.classList.add('danger');
    else if (fraction <= 0.5) cdFill.classList.add('warning');

    const secs = Math.round(remaining);
    cdTime.textContent = secs;
}

/** Update the live-detection banner. */
function updateDetectBanner(result, targetChord) {
    const { status, chord, rawChord, score } = result;

    if (status === 'silent' || !rawChord) {
        detectBanner.className = 'detect-banner idle';
        detectIcon.textContent = '🎤';
        detectChordName.textContent = 'Listening…';
        detectChordDetail.textContent = 'Play a chord';
        detectBar.style.width = '0%';
        return;
    }

    const pct = Math.round(Math.min(1, score) * 100);
    detectBar.style.width = pct + '%';
    detectChordDetail.textContent = `${pct}% match`;

    if (chord && targetChord && chord.toLowerCase() === targetChord.toLowerCase()) {
        detectBanner.className = 'detect-banner correct';
        detectIcon.textContent = '✅';
        detectChordName.textContent = `${CHORD_DISPLAY_NAMES[chord.toLowerCase()] ?? chord} — Correct!`;
    } else if (rawChord && targetChord && rawChord.toLowerCase() !== targetChord.toLowerCase()) {
        detectBanner.className = 'detect-banner wrong';
        detectIcon.textContent = '❌';
        detectChordName.textContent = `Hearing: ${CHORD_DISPLAY_NAMES[rawChord.toLowerCase()] ?? rawChord}`;
    } else {
        detectBanner.className = 'detect-banner hearing';
        detectIcon.textContent = '👂';
        detectChordName.textContent = `Hearing: ${rawChord ? (CHORD_DISPLAY_NAMES[rawChord.toLowerCase()] ?? rawChord) : '…'}`;
    }
}

/** Update the session stat cards. */
function updateStats(remaining, elapsed, chordsCompleted, total) {
    const rem = Math.round(remaining);
    const rm = Math.floor(rem / 60), rs = rem % 60;
    statTime.textContent = `${rm}:${rs.toString().padStart(2, '0')}`;

    const el = Math.round(elapsed);
    const em2 = Math.floor(el / 60), es = el % 60;
    statElapsed.textContent = `${em2}:${es.toString().padStart(2, '0')}`;

    statChords.textContent = `${chordsCompleted} / ${total}`;
    statAccuracy.textContent = totalDetections > 0
        ? Math.round((correctDetections / totalDetections) * 100) + '%'
        : '—';
}

/** Reset all practice UI to idle state. */
function resetPracticeUI() {
    targetChordName.textContent = '—';
    targetChordFull.textContent = 'Start the session';
    targetCard.className = 'target-card';

    cdTime.textContent = '--';
    cdIcon.textContent = '🎸';
    cdFill.style.strokeDashoffset = '0';
    cdFill.classList.remove('warning', 'danger');

    renderPipeline(DEFAULT_CHORD_SEQUENCE, 0);
    // reset pipeline to all-pending
    chordPipeline.querySelectorAll('.chord-pip').forEach((el, i) => {
        el.className = 'chord-pip pending';
        el.querySelector('.pip-circle').textContent = DEFAULT_CHORD_SEQUENCE[i];
    });

    detectBanner.className = 'detect-banner idle';
    detectIcon.textContent = '🎤';
    detectChordName.textContent = 'Listening…';
    detectChordDetail.textContent = '';
    detectBar.style.width = '0%';

    statChords.textContent = `0 / ${DEFAULT_CHORD_SEQUENCE.length}`;
    statTime.textContent = '--:--';
    statElapsed.textContent = '0:00';
    statAccuracy.textContent = '—';

    detectedNotes.innerHTML = '<span class="note-chip muted">—</span>';
    sessionComplete.classList.add('hidden');
    totalDetections = 0; correctDetections = 0;
}

// ── Free Play Mode ─────────────────────────────────────────────────────────────

let isFreePlayActive = false;

async function startFreePlay() {
    btnStartFreePlay.disabled = true;
    btnStartMic.disabled = true; // disable practice session

    freePlayChordName.textContent = '...';
    freePlayChordFull.textContent = 'Listening...';
    freePlayCard.className = 'target-card';

    const ok = await audioDetector.start(onFreePlayDetection);
    if (!ok) {
        freePlayChordName.textContent = 'Error';
        freePlayChordFull.textContent = 'Microphone access denied';
        btnStartFreePlay.disabled = false;
        btnStartMic.disabled = false;
        return;
    }

    isFreePlayActive = true;
    btnStartFreePlay.disabled = true;
    btnStopFreePlay.disabled = false;
}

function stopFreePlay() {
    audioDetector.stop();
    isFreePlayActive = false;

    btnStartFreePlay.disabled = false;
    btnStopFreePlay.disabled = true;
    btnStartMic.disabled = false; // re-enable practice session

    freePlayChordName.textContent = '—';
    freePlayChordFull.textContent = 'Waiting for audio...';
    freePlayCard.className = 'target-card';
    freePlayNotes.innerHTML = '<span class="note-chip muted">—</span>';
}

function onFreePlayDetection(result) {
    const { status, chord, rawChord, noteNames } = result;

    // Update notes
    const unique = [...new Set(noteNames.filter(Boolean))];
    if (unique.length === 0) {
        freePlayNotes.innerHTML = '<span class="note-chip muted">—</span>';
    } else {
        freePlayNotes.innerHTML = unique.map(n => {
            return `<span class="note-chip other-note">${n}</span>`;
        }).join('');
    }

    // Update chord display
    if (status === 'silent' || !rawChord) {
        freePlayChordName.textContent = '—';
        freePlayChordFull.textContent = 'Waiting for audio...';
        freePlayCard.className = 'target-card';
    } else {
        // If it's a confirmed chord, show it clearly
        if (chord) {
            freePlayChordName.textContent = chord;
            freePlayChordFull.textContent = CHORD_DISPLAY_NAMES[chord] || chord;
            freePlayCard.className = 'target-card correct';
        } else {
            // Unconfirmed but heard
            freePlayChordName.textContent = rawChord;
            freePlayChordFull.textContent = 'Detecting...';
            freePlayCard.className = 'target-card';
        }
    }
}

// ── PracticeSession event handlers ───────────────────────────────────────────

function onSessionTick(remaining, elapsed) {
    if (!practiceSession) return;
    const total = practiceSession.duration;
    updateCountdownRing(remaining, total);
    updateStats(remaining, elapsed, practiceSession.chordsCompleted, practiceSession.chordSequence.length);
}

function onChordChange(chord, index) {
    targetChordName.textContent = chord;
    targetChordFull.textContent = CHORD_DISPLAY_NAMES[chord.toLowerCase()] ?? chord;
    targetCard.className = 'target-card';
    cdIcon.textContent = '🎵';
    renderPipeline(DEFAULT_CHORD_SEQUENCE, index);
    setAudioResult('silent', '🎤', `Play: ${CHORD_DISPLAY_NAMES[chord.toLowerCase()] ?? chord}`);
}

function onCorrect(chord, nextChord, index) {
    correctDetections++;
    // Flash green on target card
    targetCard.className = 'target-card correct';
    cdIcon.textContent = '✅';
    const msg = nextChord
        ? `${chord} ✅  →  Next: ${CHORD_DISPLAY_NAMES[nextChord.toLowerCase()] ?? nextChord}`
        : `${chord} ✅  All chords done!`;
    setAudioResult('correct', '⭐', msg);
    setTimeout(() => { targetCard.className = 'target-card'; }, 600);
}

function onSessionComplete(stats) {
    cdFill.style.strokeDashoffset = CD_CIRCUMFERENCE;
    cdTime.textContent = '0';
    cdIcon.textContent = '🏆';
    targetChordName.textContent = '🏆';
    targetChordFull.textContent = 'Session complete!';

    completeDetail.textContent =
        `✅ ${stats.chordsCompleted} / ${stats.total} chords completed in ${Math.round(stats.elapsed)}s`;
    sessionComplete.classList.remove('hidden');
    setAudioResult('goal-done', '🏆', `Session complete! ${stats.chordsCompleted}/${stats.total} chords ✅`);

    stopMic(false /* already stopping from session */);
}

// ── Detection callback (fed from AudioChordDetector) ────────────────────────

function onAudioDetection(result) {
    totalDetections++;
    if (result.chord) correctDetections++;

    const target = practiceSession?.currentChord;
    updateNoteChips(result.noteNames, target);
    updateDetectBanner(result, target);

    // Forward to session state machine
    if (practiceSession?.isActive) {
        practiceSession.onDetection(result);
    }
}

// ── VU meter animation ───────────────────────────────────────────────────────

function animateMeter() {
    if (!audioDetector.isRunning) return;
    const vol = audioDetector.getVolume();
    meterBars.forEach((bar, i) => {
        const noise = 0.4 + 0.6 * Math.abs(Math.sin(performance.now() / 200 + i * 0.8));
        const h = Math.max(4, vol * 44 * noise);
        bar.style.height = h + 'px';
        bar.classList.toggle('active', vol > 0.05);
    });
    meterRafId = requestAnimationFrame(animateMeter);
}

// ── Start / Stop session ─────────────────────────────────────────────────────

async function startMic() {
    btnStartMic.disabled = true;
    btnStartFreePlay.disabled = true; // disable free play if practice started
    setAudioResult('idle', '⏳', 'Requesting microphone access…');

    const ok = await audioDetector.start(onAudioDetection);
    if (!ok) {
        setAudioResult('wrong', '🚫', 'Microphone access denied — please allow mic permissions.');
        btnStartMic.disabled = false;
        return;
    }

    const duration = parseInt(durationSelect?.value ?? '30', 10);

    practiceSession = new PracticeSession({ duration, chordSequence: DEFAULT_CHORD_SEQUENCE, minHoldMs: 400 });
    practiceSession.onTick = onSessionTick;
    practiceSession.onChordChange = onChordChange;
    practiceSession.onCorrect = onCorrect;
    practiceSession.onComplete = onSessionComplete;

    resetPracticeUI();
    if (durationSelect) durationSelect.disabled = true;

    // Initialise countdown ring to full
    updateCountdownRing(duration, duration);
    cdTime.textContent = duration;

    practiceSession.start();

    btnStartMic.disabled = true;
    btnStopMic.disabled = false;
    animateMeter();
}

function stopMic(manual = true) {
    if (practiceSession?.isActive) practiceSession.stop();
    practiceSession = null;

    audioDetector.stop();
    if (meterRafId) { cancelAnimationFrame(meterRafId); meterRafId = null; }
    meterBars.forEach(bar => { bar.style.height = '4px'; bar.classList.remove('active'); });

    btnStartMic.disabled = false;
    btnStopMic.disabled = true;
    btnStartFreePlay.disabled = false; // re-enable free play
    if (durationSelect) durationSelect.disabled = false;

    if (manual) {
        setAudioResult('idle', '🎸', 'Session ended. Press Start Practice to try again.');
        cdIcon.textContent = '🎸';
        cdTime.textContent = '--';
    }
    detectedNotes.innerHTML = '<span class="note-chip muted">—</span>';
}

// ── Event listeners ──────────────────────────────────────────────────────────

btnStart.addEventListener('click', startCamera);
btnStop.addEventListener('click', stopCamera);

if (btnStartMic) btnStartMic.addEventListener('click', startMic);
if (btnStopMic) btnStopMic.addEventListener('click', stopMic);

if (btnStartFreePlay) btnStartFreePlay.addEventListener('click', startFreePlay);
if (btnStopFreePlay) btnStopFreePlay.addEventListener('click', stopFreePlay);

btnCalibrate.addEventListener('click', startCalibration);
btnConfirm.addEventListener('click', confirmCalibration);
btnCancel.addEventListener('click', () => { endCalibration(); setHint('Calibration cancelled.'); });

leftHandedToggle?.addEventListener('change', (e) => {
    isLeftHanded = e.target.checked;
    fretMapper.isLeftHanded = isLeftHanded;
    // Auto re-render if camera is off but we have landmarks, though usually renderer just picks it up next frame
});

chordSelect.addEventListener('change', (e) => {
    const name = e.target.value;
    chordModel.setCurrentChord(name || null);
    if (name) {
        renderChordChart(name);
        setHint('🎯 E Minor — Place middle finger on A string fret 2, ring finger on D string fret 2.');
    } else {
        chordChart.innerHTML = '<p class="hint-text">E Minor is pre-selected for you.</p>';
        setHint('🎸 E Minor is ready — start camera to begin tracking.');
    }
    updateScoreUI(null);
});

// Resize canvas when window resizes
window.addEventListener('resize', () => {
    if (isRunning) renderer.syncSize(video);
});

// ── Gemini Chatbot Handlers ──────────────────────────────────────────────────

let isChatOpen = false;

function toggleChatbot() {
    isChatOpen = !isChatOpen;
    if (isChatOpen) {
        chatbotWidget.classList.add('open');
        chatbotToggleBtn.classList.add('hidden');
        chatbotInput.focus();

        // Initialize Gemini only when first opened to save resources
        if (!chatbotService.isReady) {
            const ok = chatbotService.init();
            if (!ok) {
                appendChatMessage("System", "Error initializing AI Coach. Have you set your VITE_GEMINI_API_KEY in .env.local?");
            }
        }
    } else {
        chatbotWidget.classList.remove('open');
        chatbotToggleBtn.classList.remove('hidden');
    }
}

function appendChatMessage(sender, text, isHTML = false) {
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${sender === 'User' ? 'user' : 'model'}`;

    // Convert rudimentary markdown-like output to basic HTML for bot
    let formattedText = text;
    if (sender !== 'User' && !isHTML) {
        // bold
        formattedText = formattedText.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        // bullet points
        formattedText = formattedText.replace(/^\* (.*?)$/gm, '<li>$1</li>');
        formattedText = formattedText.replace(/<li>.*<\/li>/s, match => `<ul>${match}</ul>`);
        formattedText = formattedText.replace(/\n\n/g, '</p><p>');
        msgDiv.innerHTML = `<p>${formattedText}</p>`;
    } else if (isHTML) {
        msgDiv.innerHTML = text;
    } else {
        msgDiv.textContent = text;
    }

    chatbotMessages.appendChild(msgDiv);
    chatbotMessages.scrollTop = chatbotMessages.scrollHeight;
    return msgDiv;
}

async function sendChatMessage() {
    const text = chatbotInput.value.trim();
    if (!text) return;

    // 1. Add User message
    appendChatMessage('User', text);
    chatbotInput.value = '';
    chatbotSendBtn.disabled = true;

    // 2. Add temporary typing indicator
    const typingId = `typing-${Date.now()}`;
    appendChatMessage('System', `
        <div class="typing-indicator" id="${typingId}">
            <span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span>
        </div>
    `, true);

    // 3. Request Gemini
    const responseText = await chatbotService.sendMessage(text);

    // 4. Remove typing indicator and add response
    const loader = document.getElementById(typingId);
    if (loader && loader.parentElement) {
        loader.parentElement.remove();
    }

    appendChatMessage('Model', responseText);
    chatbotSendBtn.disabled = false;
    chatbotInput.focus();
}

chatbotToggleBtn?.addEventListener('click', toggleChatbot);
chatbotCloseBtn?.addEventListener('click', toggleChatbot);
chatbotSendBtn?.addEventListener('click', sendChatMessage);
chatbotInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendChatMessage();
});

// ── Inject dynamic chart styles ───────────────────────────────────────────────

const chartStyles = document.createElement('style');
chartStyles.textContent = `
  .chart-grid { display: flex; flex-direction: column; gap: 3px; margin: 8px 0; }
  .chart-row  { display: flex; align-items: center; gap: 8px; font-size: 0.75rem; }
  .chart-string { color: var(--text-muted); width: 14px; text-align: right; font-size: 0.7rem; }
  .chart-fret { padding: 2px 8px; border-radius: 4px; font-weight: 700; min-width: 32px; text-align: center; }
  .chart-fret.fret  { background: rgba(79,156,249,0.18); color: var(--accent); border: 1px solid rgba(79,156,249,0.3); }
  .chart-fret.open  { background: rgba(45,212,160,0.12); color: var(--success); border: 1px solid rgba(45,212,160,0.25); }
  .chart-fret.muted { background: rgba(249,112,102,0.1); color: var(--danger);  border: 1px solid rgba(249,112,102,0.2); }
`;
document.head.appendChild(chartStyles);

// ── Init ──────────────────────────────────────────────────────────────────────

// Auto-select E Minor on load — only chord available
chordModel.setCurrentChord('Em');
if (chordSelect) {
    chordSelect.value = 'Em';
    renderChordChart('Em');
}

setStatus('Ready');
setHint('🎸 Start camera and place your middle + ring fingers at fret 2 (A & D strings) for E Minor.');

// Render initial chord pipeline
renderPipeline(DEFAULT_CHORD_SEQUENCE, 0);
// All pips start as pending
chordPipeline.querySelectorAll('.chord-pip').forEach(el => {
    el.classList.remove('active');
    el.classList.add('pending');
});

