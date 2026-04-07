/**
 * HandTrackingService.js
 * Wraps MediaPipe Hand Landmarker Web for real-time
 * 21-landmark hand detection from a live video stream.
 *
 * Landmark indices of interest:
 *   4  = Thumb tip
 *   8  = Index fingertip
 *   12 = Middle fingertip
 *   16 = Ring fingertip
 *   20 = Pinky fingertip
 *
 * Matches the fingertip_ids used in the Python prototype (test.py).
 */

import {
    HandLandmarker,
    FilesetResolver,
} from '@mediapipe/tasks-vision';

/** Fingertip landmark indices (matches Python prototype) */
export const FINGERTIP_IDS = [4, 8, 12, 16, 20];

export class HandTrackingService {
    _landmarker = null;
    _ready = false;
    _lastTimestamp = -1;

    /**
     * Initialize and load the MediaPipe Hand Landmarker model.
     * Must be called before detectForVideo().
     */
    async init() {
        try {
            const vision = await FilesetResolver.forVisionTasks(
                'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
            );

            this._landmarker = await HandLandmarker.createFromOptions(vision, {
                baseOptions: {
                    modelAssetPath:
                        'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
                    delegate: 'GPU',
                },
                runningMode: 'VIDEO',
                numHands: 1,
                minHandDetectionConfidence: 0.6,
                minHandPresenceConfidence: 0.6,
                minTrackingConfidence: 0.6,
            });

            this._ready = true;
            console.log('[HandTrackingService] Model loaded ✓');
        } catch (err) {
            console.error('[HandTrackingService] Failed to load model:', err);
            this._ready = false;
        }
    }

    get isReady() {
        return this._ready;
    }

    /**
     * Run detection on the current video frame.
     * @param {HTMLVideoElement} video
     * @param {number} timestampMs - performance.now() value
     * @returns {Array<{x:number, y:number, z:number}>[]|null}
     *   Array of hands, each hand is 21 landmarks. Returns null if no hands.
     */
    detectForVideo(video, timestampMs) {
        if (!this._ready || !this._landmarker) return null;
        // MediaPipe requires strictly increasing timestamps
        if (timestampMs <= this._lastTimestamp) return null;
        this._lastTimestamp = timestampMs;

        try {
            const result = this._landmarker.detectForVideo(video, timestampMs);
            if (!result || !result.landmarks || result.landmarks.length === 0) {
                return null;
            }
            return result.landmarks; // array of hands → each hand = 21 {x,y,z}
        } catch (err) {
            return null;
        }
    }

    /**
     * Extract only the 5 fingertip landmarks from a hand landmark array.
     * @param {Array<{x,y,z}>} handLandmarks - 21 landmarks for one hand
     * @returns {Array<{x:number, y:number, z:number, fingerId: number}>}
     */
    getFingertips(handLandmarks) {
        return FINGERTIP_IDS.map((id, idx) => ({
            ...handLandmarks[id],
            fingerId: id,
            fingerIndex: idx, // 0=thumb, 1=index, 2=middle, 3=ring, 4=pinky
        }));
    }

    destroy() {
        if (this._landmarker) {
            this._landmarker.close();
            this._landmarker = null;
            this._ready = false;
        }
    }
}
