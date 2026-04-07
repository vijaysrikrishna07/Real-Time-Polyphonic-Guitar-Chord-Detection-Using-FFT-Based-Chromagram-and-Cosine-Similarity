import cv2
import mediapipe as mp

mp_hands = mp.solutions.hands
hands = mp_hands.Hands()
mp_draw = mp.solutions.drawing_utils

cap = cv2.VideoCapture(0)

while True:
    success, img = cap.read()
    if not success:
        break

    img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    results = hands.process(img_rgb)

    if results.multi_hand_landmarks:
        for hand_landmarks in results.multi_hand_landmarks:
            mp_draw.draw_landmarks(img, hand_landmarks, mp_hands.HAND_CONNECTIONS)
            h, w, c = img.shape
            fingertip_ids = [4, 8, 12, 16, 20]
            for tip_id in fingertip_ids:
                lm = hand_landmarks.landmark[tip_id]
                cx = int(lm.x * w)
                cy = int(lm.y * h)
                cv2.circle(img, (cx, cy), 12, (0, 255, 0), cv2.FILLED)

    cv2.imshow("Finger Detection", img)

    if cv2.waitKey(1) & 0xFF == ord('q'):
        break

cap.release()
cv2.destroyAllWindows()
