# -*- coding: utf-8 -*-
"""참고 쇼츠 20편의 '역동성'을 숫자로 잰다 + 채널마다 프레임 시트 한 장.

잰 것 (영상마다):
  cuts        장면이 바뀐 자리 (HSV 히스토그램 거리 급변) - 컷 간격, 분당 컷
  motion      이웃 프레임 밝기 차이 평균 (0-255) - 화면이 얼마나 움직이나
  zoom        이웃 프레임 사이 크기 변화 (ORB + 닮음변환) - 확대/축소 펀치 횟수
  shake       같은 변환의 이동량 - 흔들림 횟수
  sfx         소리 에너지가 앞 0.3초 평균의 3배를 넘는 순간 - 효과음/강한 음절 밀도
출력: refs_metrics.json, sheet_<채널>.jpg (채널 5편 x 8장), 영상마다 한 줄 요약
"""
import cv2, json, os, subprocess, sys, glob
import numpy as np
sys.stdout.reconfigure(encoding="utf-8")
HERE = os.path.dirname(os.path.abspath(__file__))
REFS = os.path.join(HERE, "refs")
FPS_S = 15.0                      # 분석 표본 프레임률


def audio_onsets(path):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-vn", "-ac", "1", "-ar", "8000",
                          "-f", "s16le", "-"], capture_output=True).stdout
    x = np.frombuffer(raw, np.int16).astype(np.float32) / 32768
    if len(x) < 8000:
        return 0, 0.0
    hop = 80                                          # 10ms
    e = np.sqrt(np.convolve(x ** 2, np.ones(hop) / hop, "same")[::hop])
    ons, last = [], -1
    for i in range(30, len(e)):
        base = e[i - 30:i].mean() + 1e-4
        if e[i] > 3 * base and e[i] > 0.05 and i - last > 15:
            ons.append(i / 100.0)
            last = i
    return len(ons), len(x) / 8000.0


def analyze(path):
    cap = cv2.VideoCapture(path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    w, h = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    step = max(1, int(round(fps / FPS_S)))
    orb = cv2.ORB_create(500)
    prev_h = prev_g = prev_kp = prev_des = None
    cuts, motion, zooms, shakes, thumbs = [], [], 0, 0, []
    idx = 0
    dur = n / fps
    marks = set(int(n * (k + 0.5) / 8) for k in range(8))
    while True:
        ok = cap.grab()
        if not ok:
            break
        take = idx % step == 0
        near_mark = any(abs(idx - m) < step for m in marks) and len(thumbs) < 8
        if take or near_mark:
            _, fr = cap.retrieve()
            t = idx / fps
            if near_mark and (not thumbs or idx - thumbs[-1][0] >= step):
                thumbs.append((idx, cv2.resize(fr, (135, int(135 * h / w)))))
            if take:
                small = cv2.resize(fr, (180, int(180 * h / w)))
                g = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
                hsv = cv2.cvtColor(small, cv2.COLOR_BGR2HSV)
                hist = cv2.calcHist([hsv], [0, 1], None, [32, 16], [0, 180, 0, 256])
                cv2.normalize(hist, hist)
                kp, des = orb.detectAndCompute(g, None)
                if prev_h is not None:
                    dist = cv2.compareHist(prev_h, hist, cv2.HISTCMP_BHATTACHARYYA)
                    motion.append(float(np.mean(cv2.absdiff(g, prev_g))))
                    if dist > 0.45 and (not cuts or t - cuts[-1] > 0.2):
                        cuts.append(round(t, 2))
                    elif des is not None and prev_des is not None and len(kp) > 20 and len(prev_kp) > 20:
                        m = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True).match(prev_des, des)
                        if len(m) > 20:
                            a = np.float32([prev_kp[x.queryIdx].pt for x in m])
                            b = np.float32([kp[x.trainIdx].pt for x in m])
                            M, inl = cv2.estimateAffinePartial2D(a, b, ransacReprojThreshold=2.0)
                            if M is not None and inl is not None and inl.sum() > 15:
                                s = float(np.hypot(M[0, 0], M[1, 0]))
                                tr = float(np.hypot(M[0, 2], M[1, 2]))
                                if abs(s - 1) > 0.03:
                                    zooms += 1
                                if tr > 4:
                                    shakes += 1
                prev_h, prev_g, prev_kp, prev_des = hist, g, kp, des
        idx += 1
    cap.release()
    n_on, adur = audio_onsets(path)
    shots = np.diff([0.0] + cuts + [dur]) if dur else np.array([0])
    return {
        "file": os.path.basename(path), "dur": round(dur, 1), "size": [w, h], "fps": round(fps, 1),
        "cuts": len(cuts), "cutsPerMin": round(len(cuts) / dur * 60, 1) if dur else 0,
        "avgShot": round(float(np.mean(shots)), 2), "medShot": round(float(np.median(shots)), 2),
        "motion": round(float(np.mean(motion)), 1) if motion else 0,
        "zoomFramesPct": round(100 * zooms / max(1, len(motion)), 1),
        "shakeFramesPct": round(100 * shakes / max(1, len(motion)), 1),
        "sfxPerSec": round(n_on / adur, 2) if adur else 0,
        "cutTimes": cuts,
    }, [t for _, t in thumbs[:8]]


def main():
    files = sorted(glob.glob(os.path.join(REFS, "*.mp4")))
    res, sheets = [], {}
    for f in files:
        r, th = analyze(f)
        res.append(r)
        ch = os.path.basename(f).split("_")[0]
        while len(th) < 8:
            th.append(np.zeros_like(th[0]) if th else np.zeros((240, 135, 3), np.uint8))
        th = [cv2.resize(t, (135, 240)) for t in th]
        sheets.setdefault(ch, []).append(np.hstack(th))
        print("%-22s %5.1fs %4dx%-4d cuts %3d (%5.1f/min, avg %.2fs med %.2fs) motion %5.1f zoom %4.1f%% shake %4.1f%% sfx %.2f/s"
              % (r["file"][:22], r["dur"], r["size"][0], r["size"][1], r["cuts"], r["cutsPerMin"], r["avgShot"],
                 r["medShot"], r["motion"], r["zoomFramesPct"], r["shakeFramesPct"], r["sfxPerSec"]))
    for ch, rows in sheets.items():
        cv2.imwrite(os.path.join(HERE, "sheet_%s.jpg" % ch), np.vstack(rows), [cv2.IMWRITE_JPEG_QUALITY, 82])
    json.dump(res, open(os.path.join(HERE, "refs_metrics.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("sheets:", sorted(sheets))


if __name__ == "__main__":
    main()
