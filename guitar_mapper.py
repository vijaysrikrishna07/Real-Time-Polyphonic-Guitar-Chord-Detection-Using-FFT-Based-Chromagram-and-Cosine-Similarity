import cv2
import mediapipe as mp

# Setup MediaPipe
mp_hands = mp.solutions.hands
hands = mp_hands.Hands()
mp_draw = mp.solutions.drawing_utils

cap = cv2.VideoCapture(0)

# Define fretboard rectangle (ROI)
x1, y1 = 100, 100
x2, y2 = 500, 300

while True:
    ret, frame = cap.read()
    if not ret:
        break

    h, w, c = frame.shape

    # Convert to RGB for mediapipe
    img_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    results = hands.process(img_rgb)

    # -------- DRAW GRID --------
    cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 255, 0), 2)

    # Horizontal lines (strings)
    for i in range(1, 6):
        y = y1 + i * (y2 - y1) // 6
        cv2.line(frame, (x1, y), (x2, y), (255, 0, 0), 1)

    # Vertical lines (frets)
    for i in range(1, 5):
        x = x1 + i * (x2 - x1) // 5
        cv2.line(frame, (x, y1), (x, y2), (0, 0, 255), 1)

    # -------- HAND DETECTION --------
    if results.multi_hand_landmarks:
        for hand_landmarks in results.multi_hand_landmarks:

            mp_draw.draw_landmarks(frame, hand_landmarks, mp_hands.HAND_CONNECTIONS)

            fingertip_ids = [4, 8, 12, 16, 20]

            for tip_id in fingertip_ids:
                lm = hand_landmarks.landmark[tip_id]
                cx = int(lm.x * w)
                cy = int(lm.y * h)

                cv2.circle(frame, (cx, cy), 8, (0, 255, 255), cv2.FILLED)

                # -------- MAP TO STRING + FRET --------
                if x1 < cx < x2 and y1 < cy < y2:

                    string_height = (y2 - y1) / 6
                    fret_width = (x2 - x1) / 5

                    string_number = int((cy - y1) / string_height) + 1
                    fret_number = int((cx - x1) / fret_width) + 1

                    print("String:", string_number, "Fret:", fret_number)

                    cv2.putText(frame,
                                f"S:{string_number} F:{fret_number}",
                                (cx, cy - 10),
                                cv2.FONT_HERSHEY_SIMPLEX,
                                0.5,
                                (0, 255, 0),
                                2)

    cv2.imshow("Guitar Mapping", frame)

    if cv2.waitKey(1) & 0xFF == ord('q'):
        break

cap.release()
cv2.destroyAllWindows()
