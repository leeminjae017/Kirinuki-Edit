# -*- coding: utf-8 -*-
"""붙잡은 샷(창 안 바뀜 사이 0.8초 넘는 구간)의 느린 확대 + 배경음 바닥.

push: 샷 시작+0.1초 프레임과 끝-0.1초 프레임의 창 영역을 ORB 닮음변환으로 맞춰
      크기 비 s 를 잰다. |s-1| > 3% 인 샷의 비율, 그 샷들의 초당 확대율 중앙값.
floor: 소리 50ms RMS 의 10번째 백분위 (dBFS). 말 사이에도 음악이 깔리면 높다.
"""
import cv2, json, subprocess, sys, os
import numpy as np
sys.stdout.reconfigure(encoding="utf-8")
L = json.load(open("refs_layout.json", encoding="utf-8"))
orb = cv2.ORB_create(800)
bf = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True)


def frame_at(cap, t, y0, y1):
    cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
    ok, fr = cap.read()
    if not ok:
        return None
    h = fr.shape[0]
    return cv2.cvtColor(fr[int(h * y0):int(h * y1)], cv2.COLOR_BGR2GRAY)


def scale(a, b):
    ka, da = orb.detectAndCompute(a, None)
    kb, db = orb.detectAndCompute(b, None)
    if da is None or db is None or len(ka) < 30 or len(kb) < 30:
        return None
    m = bf.match(da, db)
    if len(m) < 30:
        return None
    pa = np.float32([ka[x.queryIdx].pt for x in m]); pb = np.float32([kb[x.trainIdx].pt for x in m])
    M, inl = cv2.estimateAffinePartial2D(pa, pb, ransacReprojThreshold=2.0)
    if M is None or inl.sum() < 20:
        return None
    return float(np.hypot(M[0, 0], M[1, 0]))


def floor_db(path):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-vn", "-ac", "1", "-ar", "8000", "-f", "s16le", "-"],
                         capture_output=True).stdout
    x = np.frombuffer(raw, np.int16).astype(np.float32) / 32768
    if len(x) < 4000:
        return None
    r = np.sqrt(np.convolve(x ** 2, np.ones(400) / 400, "valid")[::400]) + 1e-6
    return round(float(20 * np.log10(np.percentile(r, 10))), 1)


out = []
for r in L:
    f = "refs/" + r["file"]
    y0, y1 = r["winTopPct"] / 100, 1 - r["winBotPct"] / 100
    cap = cv2.VideoCapture(f)
    edges = [0.0] + r["beatTimes"] + [r["dur"]]
    held, pushed, rates = 0, 0, []
    for a, b in zip(edges[:-1], edges[1:]):
        if b - a < 0.8:
            continue
        A, B = frame_at(cap, a + 0.1, y0, y1), frame_at(cap, b - 0.1, y0, y1)
        if A is None or B is None:
            continue
        s = scale(A, B)
        if s is None:
            continue
        held += 1
        if abs(s - 1) > 0.03:
            pushed += 1
            rates.append(100 * (s - 1) / (b - a - 0.2))
    cap.release()
    row = {"file": r["file"], "heldShots": held, "pushedPct": round(100 * pushed / held) if held else None,
           "zoomRatePctPerSec": round(float(np.median(rates)), 1) if rates else None, "audioFloorDb": floor_db(f)}
    out.append(row)
    print("%-22s 붙잡은 샷 %2d, 느린 확대/축소 %s%%, 초당 %s%% | 소리 바닥 %s dB"
          % (r["file"][:22], held, row["pushedPct"], row["zoomRatePctPerSec"], row["audioFloorDb"]))
b = floor_db(r"E:\Edit\Claude\edited\삼성_ko.mp4")
print("삼성_ko (기준)          소리 바닥 %s dB" % b)
json.dump({"refs": out, "samsungFloorDb": b}, open("refs_push.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
