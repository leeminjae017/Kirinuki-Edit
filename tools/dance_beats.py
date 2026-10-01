# -*- coding: utf-8 -*-
"""Dance(C:D) Solo Shorts 비트 카메라 (2026-10-01) - dance_camera.py 가 프리셋 camera.mode == "dynamic" 일 때 부른다.

사용자: "춤을 더 역동적으로 보여주기 위해 카메라를 활용 (대부분의 경우 비트에 맞춰서 줌인, 아웃, 순간적인 확대, 축소등의 편집이
이루어짐) -> 움직임이 적은 경우 Dance(C:S) Solo Shorts를 베이스로 하되 추가적인 센스가 요구됨 베이스 : 센스가 3:7정도".
참고 세 편 (docs/dance_cd_refs: VzGBBlqDzqA · 52qgpnCjxcU · pPZ3raGlOh0) 은 3D 카메라 모션이라 풀샷 <-> 허벅지 위 <-> 상반신을
컷과 밀기 · 빼기로 오간다. 여기서는 2D 크롭으로 흉내 낸다:

1. 박: 소리의 스펙트럼 플럭스 -> 자기상관으로 빠르기 -> 동적 계획(Ellis)으로 박 시각 -> 저음(150Hz 밑) 온셋이 가장 센 자리를 마디 첫 박.
2. 마디마다 몸 움직임 (발 · 무게중심 · 몸 너비가 바뀌는 빠르기). 움직임이 적은 마디부터 SENSE 몫(시간)만큼 "센스" 마디,
   나머지는 C:S 트래킹 그대로 (베이스). 첫 마디는 늘 베이스 (풀샷으로 연다).
3. 샷 크기는 마디마다 머리 + 빠르게 움직이는 손 (포즈) 이 들어가는 가장 작은 것 (FRACS). 하나도 안 맞으면 그 마디는 풀샷.
   이어진 센스 마디 덩이: 1마디면 그 크기로 컷 인 -> 다음 마디 첫 박에 컷 아웃.
   2마디 넘으면 [한 단계 넓은 크기로 밀고 들어가기] -> 컷 가장 작은 크기 / 한 단계 넓게 번갈아 ... 마지막 마디는 끝 PULL_B 박에 풀샷으로 빠진다.
4. 베이스 마디 첫 박이 센 곳 (중간값 넘게) 에 순간 확대 (PULSE_Z, 올라가기 PULSE_UP · 돌아오기 PULSE_DOWN).
클로즈업은 머리 꼭대기 (몸 가운데 띠의 윤곽 꼭대기 - 팔을 들면 손이 몸 상자 꼭대기가 된다) 와 상반신 무게중심을 C:S 한도로 따라간다.
"""
import subprocess
import numpy as np
from numpy.lib.stride_tricks import sliding_window_view
from scipy.ndimage import gaussian_filter1d

# ---- 수치 (measured = docs/dance_cd_refs 세 편을 프레임마다 배경 기준 닮음변환으로 잰 것, 2026-10-01) ----
SENSE = 0.7        # 사용자 "베이스 : 센스가 3:7정도" -> 시간의 70% 를 센스 마디로. measured 참고본 풀샷 시간 14-49%
# 샷 크기는 몸이 몇 할 보이느냐로 잡는다. 참고본 컷 배율은 들어갈 때 x2.0 (pPZ3 2.01 · 2.01 · 2.02) · x2.7-3.3 (52qg 2.71 · 2.76 · 2.86,
# pPZ3 3.27) 인데 그쪽 풀샷은 여백이 커서, 러브어택 (풀샷 상자 651px) 에 x2 를 걸면 이미 머리-허리 (상반신) 였다 (2026-10-01 스틸)
# 머리 꼭대기부터 몸 높이의 몇 할을 담나. 마디마다 머리 + 움직이는 손이 들어가는 가장 작은 것 (사용자 "손동작이 다이나믹한데 잘리고 얼굴만
# 나오면 이상하잖아"). 0.40 = 머리-가슴 (참고본 x2.7-3.3 장면), 0.65 = 허벅지 위 (참고본 x2.0 장면), 0.80 = 무릎 위 (눈대중 - guess).
# 두 크기만 두었더니 허니하트 (팔을 옆으로 뻗는 춤) 는 손이 안 들어가 센스가 10% 였다
FRACS = (0.40, 0.50, 0.65, 0.80)
HMIN_CU = 0.24     # 클로즈업 상자 높이 최소 / 원본 높이. 1080 원본이면 259px 를 1920 으로 7.4배 - 러브어택 245px 스틸이 조금 무르지만 볼 만했다 (눈으로 봄)
MAX_RUN = 3        # 센스 덩이 최대 마디 수 - 덩이 사이에는 풀샷 마디가 하나 넘게 낀다. 첫 판에 뒤 9마디 (18초) 가 통째 클로즈업이 됐다.
                   # measured 참고본 클로즈업 머무름 1-4.5초 뒤 풀샷으로 돌아온다 (VzGB 0-5초 · pPZ3 5.3-8.0초)
CU_HEAD = 0.04     # 클로즈업 머리 위 여백 / 상자 높이. 사용자 "머리 위에 여백이 너무 많이 남고" (0.14 일 때 러브어택 얼굴 컷 머리 위가 화면의 ~19%).
                   # 참고본 클로즈업은 머리 꼭대기가 화면 위 끝에서 0-5% (장면 모음 눈대중)
# 어디가 움직이나 - 사용자 "어디 부분에 동작이 많은지 봐야 해 / 기본적으로 얼굴은 나오는게 좋지만 손동작이 다이나믹한데 잘리고 얼굴만 나오면 이상하잖아".
# 윤곽 차 (XOR) 로는 못 갈랐다 - 허니하트에서 0.2초마다 1600점 넘게 바뀌고 (트윈테일 · 옷) 그 폭이 허리 위 샷 너비와 같았다.
# 살색도 안 됐다 (조명에 손이 거의 하얗다). 그래서 포즈 (mediapipe pose_landmarker_full, ~/.cache/mediapipe) 로 손목 · 검지 끝을 0.2초마다 잰다 -
# 담유이 3D 모델에서 6장 모두 코 0.98 넘게, 손목 · 팔꿈치 · 무릎 제자리 (눈으로 봄).
# 손이 빠른 순간 (HAND_V 넘게) 은 머리 + 손이 다 들어가야 그 샷 크기, 손을 머리 위로 올리면 상자 위도 손까지. 손이 가만하면 머리만 (손은 잘려도 된다).
# 마디 안 FIT_SHARE 넘는 순간이 들어가야 그 마디에 그 크기
POSE_FPS = 5
LM_HAND = (15, 16, 19, 20)   # 손목 둘 · 검지 끝 둘
HAND_V = 1.0       # 손이 움직인다: 손 점 빠르기가 몸 높이 / 초 의 이만큼 넘음 (guess - 0.8 이면 허니하트 마디마다 64-100% 가 "빠름")
HAND_PAD = 0.04    # 손 둘레 여유 / 몸 높이 (guess)
HEAD_W = 0.07      # 머리 반폭 / 몸 높이 (guess)
FIT_SHARE = 0.7    # (guess - 0.8 이면 허니하트 9.5초 마디 (몸은 거의 안 움직이고 손만) 가 무릎 위 77% 로 떨어졌다)
SIDE_CU = 0.04     # 담는 범위와 상자 옆 끝 사이 여유 / 너비 (guess)
PULL_B = 2         # 빠지기 (박). measured x0.45-0.5 를 1.4-2.0박 (52qg 21.0초 · pPZ3 10.5초 · VzGB 12.8초) - 들어가기보다 빠르다.
                   # 밀기는 한 마디 (4박) 통째: measured VzGB 0-2.3초 4.5박 x3.3 · 52qg 25.1-27.1초 4.9박 x2.1
PULSE_Z = 0.12     # 순간 확대 폭. measured pPZ3 컷 곁 0.08초짜리 줌 봉우리 5번 (속도 1.9-3.1/초 -> 약 x1.1). 다섯 번뿐이라 짐작에 가깝다
PULSE_UP, PULSE_DOWN = 0.067, 0.30   # 올라가기 · 돌아오기 (초) (guess)
FIT_X, FIT_Y = 0.8, 0.3   # 클로즈업은 그 마디 동안 상반신 무게중심이 오간 폭이 상자 너비의 FIT_X, 머리 꼭대기가 오간 폭이 높이의 FIT_Y 안일 때만.
                   # 첫 판 러브어택 3.6-5.8초: 발은 덜 움직여 "움직임 적음" 으로 골렸는데 상반신이 옆으로 크게 오가 상반신 컷이 하늘만 찍었다 (guess)
HOLD_IN = 0.15     # 따라가기가 늦어도 머리는 화면 가로 15-85% 안에 붙잡아 둔다 (guess). 이게 있어서 FIT_X 를 0.5 -> 0.8 로 풀었다 (허니하트)


def poses(src, t0, t1, boxfn, cache):
    """POSE_FPS 마다 33점 (x, y, 보임) - 원본 px. 몸 상자 둘레를 잘라 넣는다 (작은 몸은 잘 못 잡는다). 편 폴더 pose.npz 캐시"""
    import os, json
    st = os.stat(src)
    key = json.dumps([src.replace(os.sep, "/"), st.st_size, int(st.st_mtime), round(t0, 3), round(t1, 3), POSE_FPS, 2])
    if os.path.exists(cache):
        z = np.load(cache)
        if str(z["key"]) == key:
            return z["t"], z["p"]
    import mediapipe as mp
    from mediapipe.tasks.python import vision, BaseOptions
    W, H = map(int, subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height",
                                    "-of", "csv=p=0", src], capture_output=True, text=True).stdout.strip().split(","))
    lm = vision.PoseLandmarker.create_from_options(vision.PoseLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=os.path.expanduser("~/.cache/mediapipe/pose_landmarker_full.task")),
        running_mode=vision.RunningMode.IMAGE))
    pr = subprocess.Popen(["ffmpeg", "-v", "error", "-ss", "%.3f" % t0, "-i", src, "-t", "%.3f" % (t1 - t0), "-vf", "fps=%d:round=up" % POSE_FPS,   # 기본은 칸의 마지막 장 - t + 0.083초였다 (dance_camera.py 윤곽과 같다)
                           "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], stdout=subprocess.PIPE)
    ts, P = [], []
    while True:
        b = pr.stdout.read(W * H * 3)
        if len(b) < W * H * 3:
            break
        im = np.frombuffer(b, np.uint8).reshape(H, W, 3)
        t = t0 + len(ts) / POSE_FPS
        bx0, by0, bx1, by1 = boxfn(t)
        pad = 0.15 * (by1 - by0)
        cx0, cy0, cx1, cy1 = int(max(0, bx0 - pad)), int(max(0, by0 - pad)), int(min(W, bx1 + pad)), int(min(H, by1 + pad))
        r = lm.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(im[cy0:cy1, cx0:cx1])))
        row = np.full((33, 3), np.nan)
        if r.pose_landmarks:
            for i, q in enumerate(r.pose_landmarks[0]):
                row[i] = (cx0 + q.x * (cx1 - cx0), cy0 + q.y * (cy1 - cy0), q.visibility)
        ts.append(t); P.append(row)
    pr.kill()
    np.savez_compressed(cache, key=key, t=np.array(ts), p=np.array(P))
    return np.array(ts), np.array(P)


def beat_grid(src, t0, t1):
    """박 시각 · 마디 첫 박 위상 · BPM · 박마다 온셋 세기 (원본 시각)"""
    sr, hop, n = 22050, 512, 2048
    raw = subprocess.run(["ffmpeg", "-v", "error", "-ss", "%.3f" % t0, "-i", src, "-t", "%.3f" % (t1 - t0), "-ac", "1",
                          "-ar", str(sr), "-f", "s16le", "-"], capture_output=True).stdout
    y = np.frombuffer(raw, np.int16).astype(np.float32) / 32768
    L = np.log1p(1000 * np.abs(np.fft.rfft(sliding_window_view(y, n)[::hop] * np.hanning(n), axis=1)))
    env = np.maximum(0, np.diff(L, axis=0)).sum(1)
    low = np.maximum(0, np.diff(L[:, :int(150 * n / sr)], axis=0)).sum(1)
    fo = sr / hop
    tt = t0 + (np.arange(len(env)) + 1) * hop / sr + n / 2 / sr          # 창 가운데
    env = np.maximum(env - gaussian_filter1d(env, fo * 0.5), 0)
    env /= env.std() + 1e-9
    # 빠르기: 자기상관, 120 BPM 둘레를 조금 더 믿는다 (두 배 · 반 배 헷갈림)
    m = len(env)
    f = np.fft.rfft(env - env.mean(), 2 * m)
    ac = np.fft.irfft(f * np.conj(f))[:m]
    bpm = 60 * fo / np.maximum(np.arange(m), 1)
    w = np.where((bpm >= 70) & (bpm <= 180), np.exp(-0.5 * (np.log2(bpm / 120) / 0.9) ** 2), 0)
    w[0] = 0
    k = int(np.argmax(ac * w))
    a, b, c = ac[k - 1], ac[k], ac[k + 1]
    p = k + 0.5 * (a - c) / (a - 2 * b + c + 1e-9)              # 포물선으로 다듬은 박 간격 (프레임)
    # 박: 동적 계획 (Ellis 2007, tightness 100)
    score, back = env.copy(), np.full(m, -1)
    for i in range(m):
        lo, hi = max(0, i - int(2 * p)), i - int(p / 2)
        if hi <= lo:
            continue
        j = np.arange(lo, hi)
        cand = score[j] - 100 * np.log((i - j) / p) ** 2
        q = int(np.argmax(cand))
        if cand[q] > 0:
            score[i] += cand[q]; back[i] = j[q]
    i = m - int(p) + int(np.argmax(score[m - int(p):]))
    idx = []
    while i >= 0:
        idx.append(i); i = back[i]
    idx = np.array(idx[::-1])
    ph = int(np.argmax([low[idx[q::4]].mean() if len(idx[q::4]) else 0 for q in range(4)]))
    return tt[idx], ph, 60 * fo / p, env[idx]


def plan(T, body, base, ctx):
    """프레임마다 (x, top, h) 와 컷 표시. body = [x0, y0, x1, y1, cx, 머리 y, 상반신 cx], base = C:S (X, TOP, H)"""
    SW, SH, ASP, DFPS = ctx["SW"], ctx["SH"], ctx["ASP"], ctx["DFPS"]
    follow, dead = ctx["follow"], ctx["dead"]
    x0, y0, x1, y1, mc, hy, uc = body.T
    X, TOP, H = (np.asarray(v, float) for v in base)
    n = len(T)
    bt, ph, bpm, st = beat_grid(ctx["src"], T[0], T[-1])
    per = 60 / bpm
    down = bt[ph::4]
    fr = lambda t: int(np.clip(np.searchsorted(T, t - 0.5 / DFPS), 0, n - 1))     # t 에 가장 가까운 키 프레임
    edges = [0] + [fr(t) for t in down if T[0] + 0.5 / DFPS < t < T[-1]] + [n - 1]
    bars = [(a, b) for a, b in zip(edges, edges[1:]) if b > a]
    href = float(np.median(H))
    body_h = float(np.percentile(y1 - hy, 75))     # 선 키 (웅크림 · 뛰기에 샷 크기가 안 흔들리게)
    d = lambda v: np.abs(np.diff(v, prepend=v[0])) * DFPS / href
    mot = d(y1) + d(mc) + d(x1 - x0)
    bm = np.array([mot[a:b].mean() for a, b in bars])
    cu_h = lambda frac: float(np.clip(body_h * frac / (1 - CU_HEAD), HMIN_CU * SH, SH))
    # 손: 포즈 0.2초마다. 빠르기는 앞뒤 표본 차 (둘 다 보일 때), 앞뒤 한 표본까지 넓혀 본다
    import os
    pt_t, PS = poses(ctx["src"], T[0], T[-1], lambda t: [np.interp(t, T, v) for v in (x0, y0, x1, y1)],
                     os.path.join(ctx["work"], "pose.npz"))
    hand = PS[:, LM_HAND, :]
    seen = hand[:, :, 2] > 0.5
    sp = np.zeros(len(pt_t))
    for i in range(1, len(pt_t)):
        both = seen[i] & seen[i - 1]
        if both.any():
            sp[i] = np.max(np.hypot(*(hand[i, both, :2] - hand[i - 1, both, :2]).T)) * POSE_FPS / body_h
    dyn = np.maximum.reduce([sp, np.roll(sp, 1), np.roll(sp, -1)]) > HAND_V

    def frame(frac, i):
        """샷 크기 frac 로 표본 i 에 머리 (+ 움직이는 손) 를 담을 가운데 x · 위 y 와 담기는지"""
        h = cu_h(frac)
        t = pt_t[i]
        top = np.interp(t, T, hy) - CU_HEAD * h
        u = np.interp(t, T, uc)
        lo, hi, ok = u - HEAD_W * body_h, u + HEAD_W * body_h, True
        if dyn[i] and seen[i].any():
            hp = hand[i, seen[i], :2]
            pad = HAND_PAD * body_h
            lo, hi = min(lo, hp[:, 0].min() - pad), max(hi, hp[:, 0].max() + pad)
            top = min(top, hp[:, 1].min() - pad)
            ok = hp[:, 1].max() + pad <= top + h
        return (lo + hi) / 2, top, ok and (hi - lo) <= h * ASP * (1 - 2 * SIDE_CU)
    cen, topv, fitp = {}, {}, {}
    for frac in FRACS:
        r = [frame(frac, i) for i in range(len(pt_t))]
        cen[frac], topv[frac], fitp[frac] = (np.array(v) for v in zip(*r))
    def fits_motion(k, frac):
        m = (pt_t >= T[bars[k][0]]) & (pt_t < T[bars[k][1]])
        return not m.any() or fitp[frac][m].mean() >= FIT_SHARE
    fits = lambda k, frac: fits_motion(k, frac) and (np.ptp(uc[bars[k][0]:bars[k][1]]) < FIT_X * cu_h(frac) * ASP and
                            np.ptp(hy[bars[k][0]:bars[k][1]]) < FIT_Y * cu_h(frac))
    fitf = [next((f_ for f_ in FRACS if fits(k, f_)), None) for k in range(len(bars))]   # 그 마디에 맞는 가장 작은 샷
    if os.environ.get("DANCE_DEBUG"):
        for k, (a, b) in enumerate(bars):
            m = (pt_t >= T[a]) & (pt_t < T[b])
            print("마디 %5.2f 움직임 %.2f 손빠름 %.0f%% 맞는샷 %s | 손담김 %s | 오간폭 x %.2f y %.2f (0.80 샷 기준)" % (
                T[a], bm[k], 100 * dyn[m].mean() if m.any() else 0, fitf[k],
                " ".join("%.0f%%" % (100 * fitp[f_][m].mean()) if m.any() else "-" for f_ in FRACS),
                np.ptp(uc[a:b]) / (cu_h(0.8) * ASP), np.ptp(hy[a:b]) / cu_h(0.8)))
    looser = lambda f_: FRACS[min(FRACS.index(f_) + 1, len(FRACS) - 1)]                    # 한 단계 넓게

    # 센스 마디: 첫 마디 뺀 나머지에서 움직임이 적은 것부터 시간 몫을 채운다
    total = T[-1] - T[0]
    sense = np.zeros(len(bars), bool)
    acc = 0.0
    def run_len(k):
        a = b = k
        while a > 0 and sense[a - 1]:
            a -= 1
        while b + 1 < len(bars) and sense[b + 1]:
            b += 1
        return b - a + 1
    for k in np.argsort(bm):
        if k == 0 or fitf[k] is None or acc >= SENSE * total:
            continue
        sense[k] = True
        if run_len(k) > MAX_RUN:
            sense[k] = False
            continue
        acc += T[bars[k][1]] - T[bars[k][0]]
    runs, k = [], 0
    while k < len(bars):
        if sense[k]:
            j = k
            while j + 1 < len(bars) and sense[j + 1]:
                j += 1
            runs.append((k, j)); k = j + 1
        else:
            k += 1

    def cu_path(a, b, frac):
        """클로즈업 상자를 a..b 동안 따라간다 (a 에서 바로 겨눈 자리 - 컷)"""
        h = cu_h(frac)
        hh = np.full(b - a + 1, h)
        w = h * ASP
        aim_x = np.interp(T[a:b + 1], pt_t, cen[frac]) if len(pt_t) else uc[a:b + 1]
        cx = follow(dead(aim_x, ctx["DZ_X"] * hh * ASP), ctx["V_X"], ctx["A_X"], hh)
        cx = np.clip(cx, uc[a:b + 1] - (0.5 - HOLD_IN) * w, uc[a:b + 1] + (0.5 - HOLD_IN) * w)
        aim_top = np.interp(T[a:b + 1], pt_t, topv[frac]) if len(pt_t) else hy[a:b + 1] - CU_HEAD * h
        top = follow(dead(aim_top, ctx["DZ_Y"] * hh), ctx["V_Y"], ctx["A_Y"], hh)
        return np.clip(cx - w / 2, 0, SW - w), np.clip(top, 0, SH - h), hh

    oX, oT, oH = X.copy(), TOP.copy(), H.copy()
    cut = np.zeros(n, bool)
    kind = np.array(["base"] * n, dtype=object)
    ease_io = lambda u: u * u * (3 - 2 * u)
    ease_out = lambda u: 1 - (1 - u) ** 2
    for r0, r1 in runs:
        nb = r1 - r0 + 1
        # 1마디 = 맞는 가장 작은 샷으로 컷 인. 여러 마디 = 한 단계 넓은 샷으로 밀고 들어가기, 그 뒤 가장 작은 샷 / 한 단계 넓게 번갈아
        plan_ = ([("cut", fitf[r0])] if nb == 1 else
                 [("push", looser(fitf[r0]))] + [("cut", fitf[r0 + q] if q % 2 else looser(fitf[r0 + q])) for q in range(1, nb)])
        shots = []                                           # 같은 크기가 이어지면 한 샷 (같은 크기끼리 컷하면 점프 컷)
        for q, (kd, fr_) in enumerate(plan_):
            if shots and shots[-1][0] == kd == "cut" and shots[-1][1] == fr_:
                shots[-1][3] = bars[r0 + q][1]
            else:
                shots.append([kd, fr_, bars[r0 + q][0], bars[r0 + q][1]])
        for q, (kd, fr_, a, b) in enumerate(shots):
            b = b if b == n - 1 else b - 1                  # 마디 끝 프레임은 다음 마디 첫 프레임 (컷 자리) - 여기 넣으면 컷이 한 프레임 줌이 된다
            sl = slice(a, b + 1)
            if kd == "push":                                 # 풀샷에서 이어서 한 마디에 걸쳐 (컷 없음)
                px, pt, ph_ = cu_path(a, b, fr_)
                u = ease_io(np.linspace(0, 1, b - a + 1))
                oX[sl] = X[sl] + (px - X[sl]) * u; oT[sl] = TOP[sl] + (pt - TOP[sl]) * u; oH[sl] = H[sl] + (ph_ - H[sl]) * u
                kind[sl] = "push"
                continue
            px, pt, ph_ = cu_path(a, b, fr_)
            oX[sl], oT[sl], oH[sl] = px, pt, ph_
            cut[a] = True
            kind[sl] = "close" if fr_ <= 0.5 else "mid"
            if q == len(shots) - 1 and nb > 1:                       # 마지막 마디: 끝 PULL_B 박 동안 풀샷으로 빠진다
                pa = max(a + 1, b - int(round(PULL_B * per * DFPS)))
                u = ease_out(np.linspace(0, 1, b - pa + 1))
                s2, o = slice(pa, b + 1), pa - a
                oX[s2] = px[o:] + (X[s2] - px[o:]) * u
                oT[s2] = pt[o:] + (TOP[s2] - pt[o:]) * u
                oH[s2] = ph_[o:] + (H[s2] - ph_[o:]) * u
                kind[s2] = "pull"
        if nb == 1 and bars[r1][1] < n - 1:
            cut[bars[r1][1]] = True                          # 1마디 컷 인 -> 다음 마디 첫 박에 컷 아웃

    # 순간 확대: 베이스 마디 첫 박이 센 곳
    dstr = st[ph::4][:len(down)]
    thr = float(np.median(dstr)) if len(dstr) else np.inf
    pulses = []
    for t, s_ in zip(down, dstr):
        i = fr(t)
        j = i + int((PULSE_UP + PULSE_DOWN) * DFPS) + 1
        if s_ < thr or j >= n or (kind[i:j] != "base").any() or cut[i:j].any():
            continue
        tt = T[i:j] - T[i]
        f = 1 + PULSE_Z * np.where(tt < PULSE_UP, tt / PULSE_UP, 1 - ease_out(np.clip((tt - PULSE_UP) / PULSE_DOWN, 0, 1)))
        cx, cy = oX[i:j] + oH[i:j] * ASP / 2, oT[i:j] + oH[i:j] / 2
        h = oH[i:j] / f
        oX[i:j], oT[i:j], oH[i:j] = cx - h * ASP / 2, cy - h / 2, h
        kind[i:j] = "pulse"
        pulses.append(float(T[i]))
    cut[0] = False
    info = dict(bpm=bpm, beats=len(bt), bars=len(bars), sense=float(acc / total), runs=len(runs), pulses=pulses,
                downbeats=[float(t) for t in down],
                shots={kd: float(np.mean(kind == kd)) for kd in ("base", "pulse", "push", "close", "mid", "pull")}, hand_dyn=float(dyn.mean()), kind=kind)
    return oX, oT, oH, cut, info


# ---- 흐름 카메라 (C:D 둘째, 2026-10-02) ----
# 사용자 (가시나0, C:D 첫 판 3/10): "동작이 중요할때는 너무 확대해버리고 큰 움직임이 없을때는 오히려 반대로 움직이고 너무 기계적이야
# 자연스럽게 진행 되야하는데 줌 인 아웃이 너무 인위적이야 ... VzGBBlqDzqA 이런 느낌이어야 하는데 너무 C:S적인 요소를 많이 쓰는 거 같아 동적이지가 않아".
# 참고본을 5fps 로 다시 보니 (눈으로 봄) 앞 12초에 컷이 없다 - 0-2.4초 작은 풀샷에서 허벅지 위까지 한 번에 미끄러지듯 밀고, 2.4-8초 천천히
# 넓은 풀샷 (몸이 화면 높이의 0.55-0.6, isnet 10fps) 으로 빠지고, 8-9.6초 다시 민다. 카메라가 멈춰 있는 때가 거의 없다.
# 그래서 컷 · 순간 확대 · 고정 클로즈업을 버리고 배율이 늘 이어서 움직이는 길 하나로:
#  - 마디마다 몸 움직임 (몸 상자 끝 · 무게중심 빠르기) 순위로 샷 크기 - 많이 움직이는 마디는 넓게, 조용한 마디는 허벅지 위까지 (머리-가슴 클로즈업 없음)
#  - 그 마디 첫 박에서 움직이기 시작해 코사인으로 (밀기 FLOW_PUSH 박, 빼기 FLOW_PULL 박) - 몸보다 먼저 안 간다
#  - 그 위에 느린 숨 (FLOW_BREATH, 4마디 주기) - 같은 크기 마디가 이어져도 서 있지 않게
#  - 그 마디에 손이 닿는 폭은 늘 화면 안 (샷이 그만큼 넓다), 손을 머리 위로 들면 화면 위도 손까지
FLOW_CLOSE = 0.62   # 가장 조용한 마디: 머리부터 몸의 이만큼 (허벅지 위). 참고본 밀어 들어간 끝 (2.4 · 9.6초) 이 허벅지 위 (눈으로 봄)
FLOW_WIDE = 0.88    # 가장 바쁜 마디: 몸이 화면 높이의 이만큼. 참고본 넓은 샷은 0.55-0.67 (isnet 10fps, 4.5-8.4초) 이지만 0.74 로 둔 가시나0 이
                    # "C:D 넓은 샷 여백이 너무 많아" (2026-10-02). C:S 는 0.91 에서 여백 말이 없었다 -> 그보다 조금만 넓게 (guess)
FLOW_PUSH = 4       # 밀기 박 수. measured 참고본 0-2.4초 4.5박에 x2.5 (앞 판 잰 값 VzGB 4.5박 x3.3)
FLOW_PULL = 2       # 빼기 박 수 - 움직임이 커지는 마디라 더 빨리. measured 앞 판 1.4-2박
FLOW_BREATH = 0.05  # 숨 폭 (배율 ±) (guess)
FLOW_HEAD = 0.06    # 밀어 들어갔을 때 머리 위 여백 (화면 높이). 앞 판 CU_HEAD 0.04 + 조금 (guess)
FLOW_DZ = 0.03      # 가로 흔들림 무시 띠 (화면 높이). C:S DZ_C 0.01 로는 가시나0 방향 바뀜 초당 1.5번 (guess - 아래 결과로 맞춤)
FLOW_A = 2.0        # 가로 · 세로 가속 한도 (h/초²). C:S 의 A_XS 3 은 h 가 작은 (밀어 들어간) 샷에서 꺾임 0.3 h/초 (0.1초) 를 남겼다 (guess - 아래 결과로)
FLOW_ENV = 0.6      # 머리 · 든 손 꼭대기를 지난 이만큼 중 가장 높은 자리로 (박 하나 0.48초 + 조금, guess)
FLOW_AVOID = 0.15   # region 밖 (다른 캐릭터) 쪽으로 화면이 나가면 몸이 안에 남는 한 이만큼 (화면 너비) 까지 반대로 비킨다 (guess)


def plan_flow(T, body, base, ctx):
    SW, SH, ASP, DFPS, track = ctx["SW"], ctx["SH"], ctx["ASP"], ctx["DFPS"], ctx["track"]
    x0, y0, x1, y1, mcx, hy, ux = body.T
    X0, TOP0, H0 = base
    n = len(T)
    bt, ph, bpm, _ = beat_grid(ctx["src"], T[0], T[-1] + 0.05)
    bars = bt[ph::4]
    if len(bars) == 0 or bars[0] > T[0] + 1e-3:
        bars = np.concatenate([[T[0]], bars])
    beat = 60 / bpm
    bh = np.maximum(y1 - hy, 1)                     # 머리 꼭대기 - 발
    BH = float(np.median(bh))
    # 움직임: 몸 상자 끝 · 무게중심 빠르기 (몸 높이 / 초), 0.25초 다듬기
    sp = lambda a: np.abs(np.gradient(a)) * DFPS / BH
    act = gaussian_filter1d(sp(x0) + sp(x1) + 2 * sp(y1) + 2 * sp(mcx) + sp(hy), 0.25 * DFPS)
    bi = np.clip(np.searchsorted(bars, T, side="right") - 1, 0, len(bars) - 1)
    nb = len(bars)
    ba = np.array([act[bi == b].mean() if (bi == b).any() else 0 for b in range(nb)])
    rank = np.argsort(np.argsort(ba)) / max(1, nb - 1)     # 0 조용 - 1 바쁨
    h_close = FLOW_CLOSE * BH / (1 - FLOW_HEAD)
    h_wide = min(SH, BH / FLOW_WIDE)
    tgt = np.empty(nb)
    for b in range(nb):
        m = bi == b
        need_w = np.percentile(x1[m] - x0[m], 98) * 1.08 / ASP if m.any() else 0
        tgt[b] = np.clip(max(h_close * (h_wide / h_close) ** rank[b], need_w), h_close, SH)
    # 배율 길: 마디 첫 박에 목표가 바뀌고, 임계 감쇠 용수철로 따라간다 (로그 배율). 앞 판은 마디마다 코사인을 새로 시작해 앞 이동이 덜 끝난
    # 마디에서 속도가 0 으로 끊겼다 (가시나0 세로 꺾임 12번). 용수철은 속도가 이어진다. 90% 에 닿는 시간 = 밀기 FLOW_PUSH 박 · 빼기 FLOW_PULL 박
    # 숨 · 지금 손 폭도 목표에 넣는다 - 용수철 뒤에서 손 폭으로 배율을 딱 넓히면 팔을 벌릴 때마다 줌이 툭 튀었다 (9.2 · 11.1초).
    # 용수철 둘을 잇는다 (가속도 이어짐 - 하나면 마디 첫 박에 가속이 계단으로 바뀐다). 둘 이은 계단 응답 90% ≈ 5.3 / ω
    g = np.log(np.maximum(tgt[bi] * (1 + FLOW_BREATH * np.sin(2 * np.pi * (T - T[0]) / (16 * beat))), (x1 - x0) * 1.04 / ASP))
    H = np.empty(n)
    z1 = z2 = np.log(h_wide); v1 = v2 = 0.0; dt = 1.0 / DFPS
    for i in range(n):
        w = 5.3 / ((FLOW_PUSH if g[i] < z2 else FLOW_PULL) * beat)
        v1 += (w * w * (g[i] - z1) - 2 * w * v1) * dt; z1 += v1 * dt
        v2 += (w * w * (z1 - z2) - 2 * w * v2) * dt; z2 += v2 * dt
        H[i] = np.exp(z2)
    H = np.clip(H, 0.24 * SH, SH)
    W = H * ASP
    c = np.clip(np.log(h_wide / H) / np.log(h_wide / h_close), 0, 1)   # 0 넓음 - 1 밀어 들어감
    # 가로: 넓을 때 무게중심, 밀어 들어갈수록 상반신 무게중심. region 밖 쪽은 몸이 남는 한 비킨다
    cx = (1 - c) * mcx + c * ux
    reg = ctx.get("REG") or [0, 1]
    if reg[1] < 0.98:
        over = cx + W / 2 - reg[1] * SW
        room = np.maximum(0, (x0 - 0.03 * W) - (cx - W / 2))
        cx = cx - np.clip(np.minimum(over, room), 0, FLOW_AVOID * W)
    if reg[0] > 0.02:
        over = reg[0] * SW - (cx - W / 2)
        room = np.maximum(0, (cx + W / 2) - (x1 + 0.03 * W))
        cx = cx + np.clip(np.minimum(over, room), 0, FLOW_AVOID * W)
    # 박마다 좌우로 흔드는 몸을 그대로 따르면 화면이 초당 1.5번 방향을 바꿨다 - 그 폭 (FLOW_DZ) 은 무시하고 넘으면 따라간다
    # 손을 화면 안에 두는 밀기도 거르개 앞에서 (뒤에서 딱 자르면 팔을 뻗을 때마다 화면이 툭 끌려갔다), 뒤에서는 손끝만 안 나가게
    lo, hi = x1 + 0.03 * W - W / 2, x0 - 0.03 * W + W / 2
    cx = ctx["dead"](cx, FLOW_DZ * H, ())
    CX = track(np.clip(np.where(lo <= hi, np.clip(cx, lo, hi), (lo + hi) / 2), W / 2, SW - W / 2), H)
    CX = np.clip(ctx["follow"](CX, 1.0, FLOW_A, H, snap=False), W / 2, SW - W / 2)      # 손끝을 딱 붙잡지 않고 가속 한도만
    # 세로: 넓을 때 몸 가운데 = 화면 가운데, 밀어 들어갈수록 머리 꼭대기 아래 FLOW_HEAD. 든 손은 늘 안
    # 머리 · 든 손은 지난 FLOW_ENV 초 중 가장 높았던 자리로 - 박마다 끄덕이는 머리 (가시나0 23.3-23.9초 0.1초에 45px 오르내림) 를 따라 내려갔다가
    # 다시 올라오는 머리에 머리 선이 툭 걸렸다. 올라가는 쪽은 그 프레임에 바로 (지난 값만 쓴다 - 먼저 안 간다)
    env = lambda a: np.min(sliding_window_view(np.concatenate([np.full(int(FLOW_ENV * DFPS) - 1, a[0]), a]), int(FLOW_ENV * DFPS)), axis=1)
    hyE, y0E = env(hy), env(y0)
    top_w = (hyE + y1) / 2 - H / 2
    top_c = hyE - FLOW_HEAD * H
    top = (1 - c) * top_w + c * top_c
    top = np.minimum(top, y0E - 0.03 * H)
    # 발도 안 - 몸이 다 들어가는 배율일 때만 (몸 높이의 4% 여유에 걸쳐 서서히). 스위치로 켜고 끄면 그 자리에서 세로가 꺾였고 (앞 판 c < 0.5),
    # 몸이 안 들어가는 중간 샷에서 발을 넣으려 내리면 머리가 밀려 나갔다가 머리 선에 툭 걸렸다 (22.1 · 23.5초)
    wf = np.clip((H - 1.02 * bh) / (0.04 * bh), 0, 1)
    top = top + wf * np.maximum(0, (y1 + 0.02 * H - H) - top)
    top = np.minimum(top, hyE - 0.03 * H)
    top = np.clip(top, 0, SH - H)                                           # 원본 끝도 거르개 앞에서 - 뒤에서만 자르면 끝에 툭 걸린다 (23.5초)
    TOP = ctx["follow"](track(top, H), 1.0, FLOW_A, H, snap=False)
    TOP = np.minimum(TOP, hy - 0.005 * H)
    TOP = np.clip(TOP, 0, SH - H)
    X = CX - W / 2
    kind = np.where(c > 0.15, "close", "base")
    shots = {"wide": float((c <= 0.15).mean()), "mid": float(((c > 0.15) & (c <= 0.6)).mean()), "close": float((c > 0.6).mean())}
    moving = float((np.abs(np.gradient(np.log(H))) * DFPS > 0.03).mean())
    return X, TOP, H, np.zeros(n, bool), dict(flow=True, bpm=bpm, beats=len(bt), bars=nb, kind=kind, shots=shots, moving=moving,
                                               h=(h_close, h_wide))
