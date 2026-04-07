/**
 * VideoSource.js
 * Manages webcam stream via getUserMedia and binds it to the video element.
 */

export class VideoSource {
    /** @type {HTMLVideoElement} */
    _video = null;
    /** @type {MediaStream|null} */
    _stream = null;

    constructor(videoElement) {
        this._video = videoElement;
    }

    /** Start the webcam and bind stream to the video element. */
    async start() {
        try {
            this._stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    width: { ideal: 1280 },
                    height: { ideal: 720 },
                    facingMode: 'environment', // back camera on mobile, webcam on laptop
                },
                audio: false,
            });
            this._video.srcObject = this._stream;
            await new Promise((resolve, reject) => {
                this._video.onloadedmetadata = resolve;
                this._video.onerror = reject;
            });
            await this._video.play();
            return true;
        } catch (err) {
            console.error('[VideoSource] Failed to start camera:', err);
            return false;
        }
    }

    /** Stop all tracks and release the webcam. */
    stop() {
        if (this._stream) {
            this._stream.getTracks().forEach(track => track.stop());
            this._stream = null;
            this._video.srcObject = null;
        }
    }

    get isRunning() {
        return this._stream !== null && this._stream.active;
    }

    get videoElement() {
        return this._video;
    }

    /** Returns {width, height} of the active video feed */
    getDimensions() {
        return {
            width: this._video.videoWidth || 640,
            height: this._video.videoHeight || 480,
        };
    }
}
