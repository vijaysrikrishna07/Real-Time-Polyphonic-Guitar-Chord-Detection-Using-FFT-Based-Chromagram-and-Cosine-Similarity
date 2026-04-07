// Tuned 5-Chord DSP Engine Optimized for Phone Speaker Audio

export const CHORD_NOTES = {
    'em': ['E', 'G', 'B'],
    'c': ['C', 'E', 'G'],
    'g': ['G', 'B', 'D'],
    'd': ['D', 'F#', 'A'],
    'am': ['A', 'C', 'E']
};

export const CHORD_DISPLAY_NAMES = {
    'em': 'E Minor',
    'c': 'C Major',
    'g': 'G Major',
    'd': 'D Major',
    'am': 'A Minor'
};

// 12-tone chromatic scale
const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export class TunedChordDetector {
    constructor() {
        this.audioContext = null;
        this.analyser = null;
        this.micStream = null;

        // Settings for phone speaker detection
        this.FFT_SIZE = 8192; // High resolution for pitch accuracy
        // Phone speakers struggle below ~150Hz. Let's start relying on overtones from ~130Hz upwards
        this.MIN_FREQ = 130;
        this.MAX_FREQ = 2500;

        // Aggressive gating since phone noise can be prevalent
        this.SILENCE_RMS_THRESHOLD = 0.0001;

        // We only want to be CONFIDENT if it perfectly matches our 5 math templates
        this.CONFIDENCE_THRESHOLD = 0.65;
        this.HISTORY_FRAMES = 10;
        this.MIN_CONFIRM_FRAMES = 3;

        // Chroma Math Templates for the exact 5 chords (A=9, A#=10, B=11, C=0, C#=1, D=2, D#=3, E=4, F=5, F#=6, G=7, G#=8)
        // Array maps to: [C, C#, D, D#, E, F, F#, G, G#, A, A#, B]
        this.RAW_TEMPLATES = {
            'em': [0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0], // E, G, B
            'c': [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0], // C, E, G
            'g': [0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0], // G, B, D
            'd': [0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0], // D, F#, A
            'am': [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0], // A, C, E
        };

        // Normalize templates to unit vectors for pure Cosine Similarity Math
        this.normalizedTemplates = {};
        for (const [chordName, vector] of Object.entries(this.RAW_TEMPLATES)) {
            const mag = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
            this.normalizedTemplates[chordName] = vector.map(v => mag > 0 ? v / mag : 0);
        }

        // State Machine
        this.isRunning = false;
        this.detectionHistory = [];
        this.lastConfirmedChord = null;
        this._updateLoopId = null;
        this._onResult = null;
    }

    async start(onResultCallback) {
        if (this.isRunning) return true;

        try {
            this.micStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false,
                },
                video: false,
            });
        } catch (err) {
            console.error('[TunedChordDetector] Microphone failed:', err);
            return false;
        }

        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        this.analyser = this.audioContext.createAnalyser();
        this.analyser.fftSize = this.FFT_SIZE;
        this.analyser.smoothingTimeConstant = 0.2; // Fast reaction for phone speaker strumming

        const source = this.audioContext.createMediaStreamSource(this.micStream);
        source.connect(this.analyser);

        this.dataArray = new Float32Array(this.analyser.frequencyBinCount);
        this.sampleRate = this.audioContext.sampleRate;

        // Precompute Hz limits to skip processing deep bass and useless high hiss
        this.minBin = Math.floor(this.MIN_FREQ / (this.sampleRate / this.FFT_SIZE));
        this.maxBin = Math.floor(this.MAX_FREQ / (this.sampleRate / this.FFT_SIZE));

        this._onResult = onResultCallback;
        this.isRunning = true;
        this.detectionHistory = [];
        this.lastConfirmedChord = null;

        const loop = () => {
            if (!this.isRunning) return;
            this.processAudioFrame();
            this._updateLoopId = requestAnimationFrame(loop);
        };
        this._updateLoopId = requestAnimationFrame(loop);

        return true;
    }

    stop() {
        this.isRunning = false;
        if (this._updateLoopId) cancelAnimationFrame(this._updateLoopId);

        if (this.micStream) {
            this.micStream.getTracks().forEach(t => t.stop());
            this.micStream = null;
        }
        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }
    }

    // --- Math Engine ---

    processAudioFrame() {
        this.analyser.getFloatFrequencyData(this.dataArray); // Data in dB

        // Calculate active RMS purely for Volume/Silence detection
        let sumMag = 0;
        for (let i = this.minBin; i < this.maxBin; i++) {
            // Convert dB to linear magnitude (approx)
            const linearRaw = Math.pow(10, this.dataArray[i] / 20);
            sumMag += linearRaw;
        }
        const rms = sumMag / (this.maxBin - this.minBin);

        if (rms < this.SILENCE_RMS_THRESHOLD) {
            this._fireCallback('silent', null, null, rms, null);
            this.detectionHistory.push(null);
            this._maintainHistory();
            return;
        }

        // Compute 12-bin Chromagram (ignoring bass)
        const chroma = new Array(12).fill(0);
        let maxChromaVal = 0;

        for (let i = this.minBin; i < this.maxBin; i++) {
            const hz = i * (this.sampleRate / this.FFT_SIZE);
            if (hz <= 0) continue;

            // Pitch formula: p = 69 + 12 * log2(hz / 440) -> MIDI note
            let midiPitch = 69 + 12 * Math.log2(hz / 440.0);
            let pitchClassIndex = Math.round(midiPitch) % 12;
            if (pitchClassIndex < 0) pitchClassIndex += 12;

            const db = this.dataArray[i];
            const linearMag = Math.pow(10, db / 20); // 0.0 -> 1.0+ range

            // Only add significant peaks into the chromagram
            if (db > -70) {
                // By adding raw magnitude without scaling for low frequencies, 
                // we inherently favor phone speaker overtone characteristics.
                chroma[pitchClassIndex] += linearMag;
            }
        }

        // Normalize Chroma Vector
        for (let i = 0; i < 12; i++) {
            if (chroma[i] > maxChromaVal) maxChromaVal = chroma[i];
        }
        if (maxChromaVal > 0) {
            for (let i = 0; i < 12; i++) {
                chroma[i] /= maxChromaVal;
            }
        }

        // Which notes did we brightly hear?
        const detectedNoteNames = [];
        for (let i = 0; i < 12; i++) {
            if (chroma[i] > 0.4) {
                detectedNoteNames.push(NOTES[i]);
            }
        }

        // Cosine Similarity against our 5 Phone-Tuned Templates
        const scores = {};
        let bestChord = null;
        let bestScore = -1;

        // mag of raw recorded chroma vector
        const chromaMag = Math.sqrt(chroma.reduce((sum, val) => sum + val * val, 0));

        for (const [chordName, templateVector] of Object.entries(this.normalizedTemplates)) {
            let dotProduct = 0;
            for (let i = 0; i < 12; i++) {
                dotProduct += chroma[i] * templateVector[i];
            }
            // cosine similarity
            const sim = (chromaMag > 0) ? (dotProduct / chromaMag) : 0;
            scores[chordName] = sim;

            if (sim > bestScore) {
                bestScore = sim;
                bestChord = chordName;
            }
        }

        // Filter by Confidence Gate
        if (bestScore < this.CONFIDENCE_THRESHOLD) {
            this._fireCallback('detecting', null, null, rms, scores, detectedNoteNames);
            this.detectionHistory.push(null);
            this._maintainHistory();
            return;
        }

        // Wait for stability across recent frames
        this.detectionHistory.push(bestChord);
        this._maintainHistory();

        let matchCount = 0;
        for (let i = this.detectionHistory.length - 1; i >= 0; i--) {
            if (this.detectionHistory[i] === bestChord) matchCount++;
            else break;
        }

        if (matchCount >= this.MIN_CONFIRM_FRAMES) {
            if (this.lastConfirmedChord !== bestChord) {
                this.lastConfirmedChord = bestChord;
            }
            this._fireCallback('confirmed', bestChord, bestChord, rms, scores, detectedNoteNames);
        } else {
            this._fireCallback('detecting', null, bestChord, rms, scores, detectedNoteNames);
        }
    }

    getVolume() {
        if (!this.analyser) return 0;
        const volumeArray = new Uint8Array(this.analyser.frequencyBinCount);
        this.analyser.getByteFrequencyData(volumeArray);
        let sum = 0;
        for (let i = 0; i < volumeArray.length; i++) sum += volumeArray[i];
        return Math.min(1, Math.sqrt(sum / volumeArray.length) / 128.0 * 2.5);
    }

    _maintainHistory() {
        if (this.detectionHistory.length > this.HISTORY_FRAMES) {
            this.detectionHistory.shift();
        }
    }

    _fireCallback(status, chord, rawChord, rms, scores, detectedNotes = []) {
        if (this._onResult) {
            this._onResult({
                status,
                chord,
                rawChord,
                score: scores ? (scores[rawChord] || 0) : 0,
                scores: scores || {},
                noteNames: detectedNotes
            });
        }
    }
}
