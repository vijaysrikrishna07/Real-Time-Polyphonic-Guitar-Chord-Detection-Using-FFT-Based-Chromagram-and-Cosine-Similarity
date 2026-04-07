import os
import json
import librosa
import numpy as np
import warnings
from flask import Flask, request, jsonify
from flask_cors import CORS

import tensorflow as tf
from tensorflow.keras.models import Sequential
from tensorflow.keras.layers import Conv2D, MaxPooling2D, Activation, Flatten, Dropout, Dense

# Filter warnings from TF and librosa
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '2'
warnings.filterwarnings('ignore')

app = Flask(__name__)
CORS(app)

MODEL_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'models')
MODEL_JSON = os.path.join(MODEL_DIR, 'model.json')
MODEL_H5 = os.path.join(MODEL_DIR, 'model.h5')

CLASSES = ['a', 'am', 'bm', 'c', 'd', 'dm', 'e', 'em', 'f', 'g']

def create_model():
    m = Sequential()
    m.add(Conv2D(24, (5, 5), strides=(1, 1), input_shape=(128, 87, 1)))
    m.add(MaxPooling2D((4, 2), strides=(4, 2)))
    m.add(Activation('relu'))

    m.add(Conv2D(48, (5, 5), padding='valid'))
    m.add(MaxPooling2D((4, 2), strides=(4, 2)))
    m.add(Activation('relu'))

    m.add(Conv2D(48, (5, 5), padding='valid'))
    m.add(Activation('relu'))

    m.add(Flatten())
    m.add(Dropout(rate=0.5))

    m.add(Dense(64))
    m.add(Activation('relu'))
    m.add(Dropout(rate=0.5))

    m.add(Dense(10))
    m.add(Activation('softmax'))
    return m

model = None
try:
    model = create_model()
    model.load_weights(MODEL_H5)
    model.compile(optimizer="Adam", loss="categorical_crossentropy", metrics=['accuracy'])
    print("Guitar CNN model loaded successfully!")
except Exception as e:
    import traceback
    traceback.print_exc()
    print(f"Error loading model: {e}")

@app.route('/predict', methods=['POST'])
def predict():
    if not model:
        return jsonify({"error": "Model not loaded"}), 500
        
    if 'audio' not in request.files:
        return jsonify({"error": "No audio file provided"}), 400
        
    audio_file = request.files['audio']
    temp_path = "temp_recording.wav"
    audio_file.save(temp_path)
    
    try:
        # Load audio using soundfile directly if librosa doesn't handle webm by default
        y, sr = librosa.load(temp_path, sr=22050, duration=2.0)
        
        # Pad if shorter than 2 seconds
        target_len = sr * 2
        if len(y) < target_len:
            y = np.pad(y, (0, target_len - len(y)), mode='constant')
            
        ps = librosa.feature.melspectrogram(y=y, sr=sr, n_mels=128)
        
        # Shape adjustment just in case
        if ps.shape[1] > 87:
            ps = ps[:, :87]
        elif ps.shape[1] < 87:
            ps = np.pad(ps, ((0,0), (0, 87 - ps.shape[1])), mode='constant')

        ps = np.array(ps).reshape(1, 128, 87, 1)
        
        # AI ML Prediction
        predictions = model.predict(ps, verbose=0)[0]
        class_id = np.argmax(predictions)
        confidence = float(predictions[class_id])
        chord = CLASSES[class_id]
        
        # For UI display matching existing app
        noteNames = []
        if chord == 'em': noteNames = ['E', 'G', 'B']
        elif chord == 'c': noteNames = ['C', 'E', 'G']
        elif chord == 'g': noteNames = ['G', 'B', 'D']
        elif chord == 'd': noteNames = ['D', 'F#', 'A']
        elif chord == 'a': noteNames = ['A', 'C#', 'E']
        elif chord == 'am': noteNames = ['A', 'C', 'E']
        
        chord_mapped = chord.capitalize() if len(chord)==1 else chord[0].capitalize() + 'm'
        
        return jsonify({
            "status": "confirmed",
            "chord": chord_mapped,
            "rawChord": chord_mapped,
            "score": confidence,
            "noteNames": noteNames
        })
        
    except Exception as e:
        print(f"Prediction Error: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)

if __name__ == '__main__':
    app.run(port=5000, debug=False)
