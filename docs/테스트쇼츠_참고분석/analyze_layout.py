# -*- coding: utf-8 -*-
"""레이아웃(검정 띠) + 창 안의 '화면 바뀜' 박자를 잰다.

띠: 프레임 대부분에서 행 평균 밝기 < 22 인 위 · 아래 행 -> 위 띠 %, 아래 띠 %
박자: 띠를 뺀 창 안에서 이웃 표본(15fps) HSV 히스토그램 거리 > 0.22 또는
      밝기 차 평균 > 16 이면 한 번. 0.3초 안에 붙은 것은 하나로 센다.
"""
import cv2, glob, json, os, sys
import numpy as np
sys.stdout.reconfigure(encoding="utf-8")
HERE = os.path.dirname(os.path.abspath(__file__))
out = []
for f in sorted(glob.glob(os.path.join(HERE, "refs", "*.mp4"))):
    cap = cv2.VideoCapture(f)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)); dur = n / fps
    step = max(1, int(round(fps / 15)))
    frames, idx = [], 0
    while True:
        ok = cap.grab()
        if not ok:
            break
        if idx % step == 0:
            _, fr = cap.retrieve()
            frames.append((idx / fps, cv2.resize(fr, (180, 320))))
        idx += 1
    cap.release()
    rowmean = np.stack([cv2.cvtColor(fr, cv2.COLOR_BGR2GRAY).mean(axis=1) for _, fr in frames])
    dark = (rowmean < 22).mean(axis=0) > 0.8
    top = 0
    while top < 160 and dark[top]:
        top += 1
    bot = 0
    while bot < 160 and dark[319 - bot]:
        bot += 1
    # 띠 안의 글자(제목)는 밝으니 '대부분 어두운 행'이 끊긴다 -> 위 띠는 창이 시작하는 첫 '늘 밝은' 구간으로 다시 잡는다
    bright = (rowmean > 30).mean(axis=0) > 0.6
    rows = np.where(bright)[0]
    win_rows = [r for r in rows if 0.15 * 320 < r < 0.95 * 320]
    y0 = min(win_rows) if win_rows else top
    y1 = max(win_rows) if win_rows else 319 - bot
    beats, prev = [], None
    for t, fr in frames:
        w = fr[y0:y1 + 1]
        hsv = cv2.cvtColor(w, cv2.COLOR_BGR2HSV)
        h = cv2.calcHist([hsv], [0, 1], None, [32, 16], [0, 180, 0, 256]); cv2.normalize(h, h)
        g = cv2.cvtColor(w, cv2.COLOR_BGR2GRAY)
        if prev is not None:
            d = cv2.compareHist(prev[0], h, cv2.HISTCMP_BHATTACHARYYA)
            m = float(np.mean(cv2.absdiff(g, prev[1])))
            if (d > 0.22 or m > 16) and (not beats or t - beats[-1] > 0.3):
                beats.append(round(t, 2))
        prev = (h, g)
    gaps = np.diff([0.0] + beats + [dur])
    r = {"file": os.path.basename(f), "dur": round(dur, 1), "winTopPct": round(100 * y0 / 320),
         "winBotPct": round(100 * (319 - y1) / 320), "beats": len(beats),
         "beatsPerMin": round(len(beats) / dur * 60, 1), "medGap": round(float(np.median(gaps)), 2),
         "p25Gap": round(float(np.percentile(gaps, 25)), 2), "beatTimes": beats}
    out.append(r)
    print("%-22s 창 위 %2d%% 아래 %2d%% | 바뀜 %3d (%5.1f/분, 중앙 %.2fs, 하위25%% %.2fs)"
          % (r["file"][:22], r["winTopPct"], r["winBotPct"], r["beats"], r["beatsPerMin"], r["medGap"], r["p25Gap"]))
json.dump(out, open(os.path.join(HERE, "refs_layout.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
