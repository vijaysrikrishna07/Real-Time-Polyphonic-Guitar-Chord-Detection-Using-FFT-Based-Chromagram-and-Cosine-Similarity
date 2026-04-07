import cv2
import mediapipe as mp

mp_hands = mp.solutions.hands
hands = mp_hands.Hands(
    static_image_mode=False,
    max_num_hands=1,
    model_complexity=1,
    min_detection_confidence=0.7,
    min_tracking_confidence=0.7
)
mp_draw = mp.solutions.drawing_utils


cap = cv2.VideoCapture(0)

while True:
    ret, frame = cap.read()
    if not ret:
        break

    img_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    print("Processing frame...")
    results = hands.process(img_rgb)

    if results.multi_hand_landmarks:
        for hand_landmarks in results.multi_hand_landmarks:
            mp_draw.draw_landmarks(frame, hand_landmarks, mp_hands.HAND_CONNECTIONS)
            # Get fingertip coordinates
            h, w, c = frame.shape
            fingertip_ids = [4, 8, 12, 16, 20]
            for tip_id in fingertip_ids:
                x = int(hand_landmarks.landmark[tip_id].x * w)
                y = int(hand_landmarks.landmark[tip_id].y * h)
                cv2.circle(frame, (x, y), 10, (0, 255, 0), cv2.FILLED)
                print(f"Finger {tip_id}: ({x}, {y})")

    cv2.putText(frame, "Running...", (20, 40),
            cv2.FONT_HERSHEY_SIMPLEX, 1,
            (0, 255, 0), 2)

    cv2.imshow("Hand Detection", frame)

    if cv2.waitKey(1) & 0xFF == ord('q'):
        break

cap.release()
cv2.destroyAllWindows()
