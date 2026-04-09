Real-Time Polyphonic Guitar Chord Detection

### Using FFT-Based Chromagram & Cosine Similarity

  Overview

This project implements a **real-time guitar chord detection system** capable of identifying chords from **polyphonic audio signals**. It leverages **signal processing techniques** such as:

* Fast Fourier Transform (FFT)
* Chromagram feature extraction
* Cosine similarity-based chord matching

The system processes live or recorded audio input and outputs the detected chord with minimal latency.

---

##  Features

* Real-time chord detection from guitar audio
*  Supports **polyphonic input** (multiple notes played together)
*  Efficient FFT-based frequency analysis
*  Chromagram representation of pitch classes
*  Cosine similarity for chord classification
*  Lightweight — no heavy ML model required

---

## 🧠 How It Works

### 1. Audio Input

* Capture audio (microphone or file)
* Convert into frames for processing

### 2. FFT (Frequency Analysis)

* Transform time-domain signal → frequency domain
* Identify dominant frequencies in the signal
   FFT helps reveal frequency peaks corresponding to musical notes ([GitHub][1])

### 3. Chromagram Extraction

* Map frequencies into **12 pitch classes**:

  ```
  C, C#, D, D#, E, F, F#, G, G#, A, A#, B
  ```
* Output is a **12-dimensional vector** representing energy per pitch

 Chromagram is a compact representation of harmonic content ([GitHub][2])

### 4. Chord Template Matching

* Predefined chord templates (major/minor)
* Each template = binary/weighted pitch vector

### 5. Cosine Similarity

* Compare input chroma vector with chord templates
* Choose chord with highest similarity

 Cosine similarity measures alignment between vectors ([ResearchGate][3])

---

##  Project Structure

```
├── src/
│   ├── audio_processing.py
│   ├── fft_module.py
│   ├── chromagram.py
│   ├── chord_templates.py
│   └── chord_detection.py
│
├── data/
│   └── sample_audio.wav
│
├── requirements.txt
└── main.py
```

---

##  Installation

### 1. Clone the Repository

```bash
git clone https://github.com/vijaysrikrishna07/Real-Time-Polyphonic-Guitar-Chord-Detection-Using-FFT-Based-Chromagram-and-Cosine-Similarity.git
cd Real-Time-Polyphonic-Guitar-Chord-Detection-Using-FFT-Based-Chromagram-and-Cosine-Similarity
```

### 2. Install Dependencies

```bash
pip install -r requirements.txt
```

---

##  Usage

### Run Real-Time Detection

```bash
python main.py
```

### Run on Audio File

```bash
python main.py --input sample_audio.wav
```

---

##  Example Output

```
Input Audio Frame → Processing...
Detected Chord: C Major (Confidence: 0.91)

Detected Chord: G Major (Confidence: 0.87)
```

---

##  Future Improvements

*  Support for advanced chords (7th, diminished, augmented)
*  Integrate ML/DL models for improved accuracy
*  Build GUI or mobile interface
*  MIDI output integration
*  Noise robustness improvements

---

##  Applications

*  Guitar learning tools
*  Music transcription
*  Live performance analysis
*  Music information retrieval

---

##  References

* FFT-based audio analysis techniques
* Chromagram feature extraction in MIR
* Cosine similarity for pattern matching
* Real-time chord detection research papers

---

##  License

This project is open-source and available under the **MIT License**.

---

##  Author

**Vijay Sri krishna**

* GitHub: [https://github.com/vijaysrikrishna07](https://github.com/vijaysrikrishna07)

---

 Contributing

Pull requests are welcome!
For major changes, please open an issue first to discuss what you'd like to improve.

