export const CHORD_NOTES = {
    'em': ['E', 'G', 'B'],
    'c': ['C', 'E', 'G'],
    'g': ['G', 'B', 'D'],
    'd': ['D', 'F#', 'A'],
    'a': ['A', 'C#', 'E'],
    'am': ['A', 'C', 'E']
};

export const CHORD_DISPLAY_NAMES = {
    'em': 'E Minor',
    'c': 'C Major',
    'g': 'G Major',
    'd': 'D Major',
    'a': 'A Major',
    'am': 'A Minor'
};

export class MLChordDetector {
    constructor() {
        this.micStream = null;
        this.isRunning = false;
        this._onResult = null;
        this._intervalId = null;
        this.recordIntervalMs = 500; // Send audio to server every 500ms

        this.sampleRate = 44100;
        this.pcmBuffer = []; // Rolling array of raw PCM floats
        this.maxBufferLength = 0; // Will be set to ~2 seconds of audio

        this.audioContext = null;
        this.scriptNode = null;
        this.micSource = null;
        this.analyser = null;
    }

    async start(onResult) {
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
            console.error('[MLChordDetector] Mic denied:', err);
            return false;
        }

        this._onResult = onResult;
        this.isRunning = true;
        this.pcmBuffer = [];

        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        this.sampleRate = this.audioContext.sampleRate;
        this.maxBufferLength = this.sampleRate * 2; // Store up to 2 seconds of history

        this.micSource = this.audioContext.createMediaStreamSource(this.micStream);

        // Setup VU Meter for purely visual feedback in the UI
        this.analyser = this.audioContext.createAnalyser();
        this.analyser.fftSize = 256;
        this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
        this.micSource.connect(this.analyser);

        // Native PCM Capture Node using ScriptProcessor (widely supported for this)
        this.scriptNode = this.audioContext.createScriptProcessor(4096, 1, 1);
        this.scriptNode.onaudioprocess = (e) => {
            if (!this.isRunning) return;
            const inputData = e.inputBuffer.getChannelData(0);

            // Push new samples to our rolling buffer
            for (let i = 0; i < inputData.length; i++) {
                this.pcmBuffer.push(inputData[i]);
            }
            // Keep buffer size clamped to 2 seconds to avoid memory leaks
            if (this.pcmBuffer.length > this.maxBufferLength) {
                this.pcmBuffer.splice(0, this.pcmBuffer.length - this.maxBufferLength);
            }
        };

        this.micSource.connect(this.scriptNode);
        this.scriptNode.connect(this.audioContext.destination);

        // Upload loop
        this._intervalId = setInterval(() => {
            this.sendAudioToServer();
        }, this.recordIntervalMs);

        return true;
    }

    getVolume() {
        if (!this.analyser) return 0;
        this.analyser.getByteFrequencyData(this.dataArray);
        let sum = 0;
        for (let i = 0; i < this.dataArray.length; i++) {
            sum += this.dataArray[i];
        }
        const rms = Math.sqrt(sum / this.dataArray.length) / 128.0;
        return Math.min(1, rms * 2); // boost slightly for UI
    }

    async sendAudioToServer() {
        if (!this.isRunning || this.pcmBuffer.length === 0) return;

        // Snapshot current rolling buffer data
        const currentData = new Float32Array(this.pcmBuffer);

        try {
            // Encode to raw PCM WAV format Blob
            const wavBlob = this._encodeWAV(currentData, this.sampleRate);

            const formData = new FormData();
            formData.append('audio', wavBlob, 'chunk.wav');

            const result = await fetch('http://127.0.0.1:5000/predict', {
                method: 'POST',
                body: formData
            });
            const data = await result.json();

            if (this._onResult && data.chord) {
                this._onResult({
                    status: 'detecting',
                    chord: data.score > 0.4 ? data.chord : null,
                    rawChord: data.chord,
                    score: data.score,
                    scores: { [data.chord]: data.score },
                    noteNames: data.noteNames || [], // Mapped in python
                });
            }
        } catch (err) {
            console.error('[MLChordDetector] API Error:', err);
        }
    }

    stop() {
        if (!this.isRunning) return;
        this.isRunning = false;

        if (this._intervalId) {
            clearInterval(this._intervalId);
            this._intervalId = null;
        }

        if (this.scriptNode) {
            this.scriptNode.disconnect();
            this.scriptNode = null;
        }

        this.micStream?.getTracks().forEach(t => t.stop());
        this.micStream = null;

        if (this.audioContext && this.audioContext.state !== 'closed') {
            this.audioContext.close();
        }
        this.audioContext = null;
        this.analyser = null;
        this.pcmBuffer = [];
    }

    // --- Helper to convert raw PCM floats -> WAV Blob ---
    _encodeWAV(samples, sampleRate) {
        const numChannels = 1;
        const format = 1; // PCM
        const bitDepth = 16;

        const dataLength = samples.length * (bitDepth / 8);
        const bufferLength = 44 + dataLength;
        const arrayBuffer = new ArrayBuffer(bufferLength);
        const view = new DataView(arrayBuffer);

        // RIFF chunk descriptor
        this._writeString(view, 0, 'RIFF');
        view.setUint32(4, 36 + dataLength, true);
        this._writeString(view, 8, 'WAVE');

        // fmt sub-chunk
        this._writeString(view, 12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, format, true);
        view.setUint16(22, numChannels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * numChannels * (bitDepth / 8), true);
        view.setUint16(32, numChannels * (bitDepth / 8), true);
        view.setUint16(34, bitDepth, true);

        // data sub-chunk
        this._writeString(view, 36, 'data');
        view.setUint32(40, dataLength, true);

        // write PCM samples
        let offset = 44;
        for (let i = 0; i < samples.length; i++) {
            let s = Math.max(-1, Math.min(1, samples[i]));
            view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
            offset += 2;
        }

        return new Blob([view], { type: 'audio/wav' });
    }

    _writeString(view, offset, string) {
        for (let i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
        }
    }
}
