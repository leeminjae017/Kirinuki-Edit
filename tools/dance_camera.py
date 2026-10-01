# -*- coding: utf-8 -*-
"""댄스 쇼츠 트래킹 카메라 (Dance(C:S) Solo Shorts, 2026-10-01) - edit.json camera.keys 를 만든다.

사용자: "캐릭터가 화면 밖으로 나갈 것 같은 경우에 ... 풀샷을 잡기 위해서 혹은 캐릭터 중심이 중앙에 오도록, 상하좌우 여백이 많이
생기지 않도록 이동. 필요시 약간의 줌인, 줌아웃을 허용" -> 멈췄다 옮기는 첫 판은 "너무 부자연스러워 / 가능하면 최대한 계속 트래킹
하듯이 캐릭터의 중심을 기준으로 따라가야해". 그래서 카메라는 늘 몸 무게중심을 따라간다.

   -> "최대한 몸 전체가 다 나오게 줌인 아웃" -> "카메라가 캐릭터보다 먼저 이동하거나 늦게 이동하면 안돼".
1. 캐릭터: isnet-anime (~/.u2net/isnet-anime.onnx, 애니 캐릭터 분할) 윤곽을 FPS 마다 (편 폴더 char_masks.npz 캐시),
   그 사이 프레임은 윤곽 점을 광학 흐름으로 앞 · 뒤에서 옮겨 섞는다 -> DFPS 마다 몸 상자 · 무게중심.
   -> "순간적으로 크게 움직이는 이동, 줌인, 아웃이 많으면 어지러우니까 크게 변경되는 경우 오히려 천천히 ... 왔다 갔다 하는 기간 동안
   최대 너비까지 천천히 줌아웃 -> 이후에 다시 일반적으로" + "예시로 준 영상을 참고 해".
2. 카메라: 무게중심이 좁은 폭(DZ_X) 안에서 흔들리면 그대로, 넘으면 따라간다 - 참고본 -1.mov 의 속도 · 가속 · 줌 빠르기 99 백분위
   안이면 같은 프레임에, 넘치면 그만큼만 천천히 (미리 움직이지 않는다). 배율은 지난 ZWIN 동안 필요했던 가장 넓은 것을 쥔다.
   왔다 갔다 구간(꺾임 · 줌 봉우리가 0.6초 안 간격으로 4번 넘게)은 그때까지 오간 폭을 겨눠 천천히 넓히고 구간 동안 안 당긴다.
   -> "줌아웃이 너무 빠르고 캐릭터가 움직이기 전에 (동작이 화면 밖으로 나가기 전까지는) 줌아웃하면 안돼. 동작 -> 카메라 혹은
   동작 == 카메라, 카메라 -> 동작은 절대 금지": 줌아웃은 몸이 지금 화면을 넘을 때만, 앞을 보는 것(다듬기 · 구간 전체 폭)은 없다.
   DFPS 마다 키 (in: linear) - shortsmith 가 이어진 키를 한 경로로 굽는다. 거의 직선인 키는 뺀다.
3. camera.punch (챌린지 순간 확대): [{"s": 12.0, "e": 15.8, "z": 2.0}] - 그 동안 상반신으로 컷 인, 끝나면 컷 아웃.

    python tools/dance_camera.py <편 폴더> [--sheet]      edit.json camera.keys 를 쓰고 요약 · 잘림 검사를 찍는다
                                                        --sheet: camera_sheet.jpg (2초마다 원본에 상자)

수치 근거는 아래 상수 옆에 적는다 (measured = 잰 것, guess = 짐작).
"""
import io, json, os, subprocess, sys
sys.setrecursionlimit(100000)
import numpy as np
from scipy.ndimage import gaussian_filter1d, maximum_filter1d, minimum_filter1d

# ---- 수치 ----
# measured = Damyui-n152-1.mov (사용자가 -0.mov 를 세로로 다시 잡은 것) 카메라를 0.1초마다, 몸을 0.25초마다 재서 맞댐
# (알림 그림을 몸으로 잡은 7.9-14.2 · 96.8-97.8초는 뺌)
FPS = 5            # 윤곽(isnet)을 뽑는 간격 - 한 장 1.3초라 프레임마다는 못 돌린다 (CPU 뿐)
DFPS = 30          # 몸 위치 · 카메라 키 간격. 윤곽 사이는 광학 흐름으로 채운다
MW, MH = 480, 270  # 윤곽 · 흐름을 재는 크기
HEAD = 0.07        # 풀샷 머리 위 여백 / 상자 높이. measured 가운데값 0.073 (사분위 0.059-0.095)
FOOT = 0.05        # 발 아래 여백. measured 0.053 (0.039-0.079)
# 사용자 "카메라가 캐릭터보다 먼저 이동하거나 늦게 이동하면 안돼" (2026-10-01): 앞 판은 σ 0.2초 가우스 + 앞뒤 0.6초 창으로
# 카메라가 몸보다 먼저 움직이기 시작하고 늦게 멈췄다. 이제 몸 위치를 프레임마다 재고 같은 프레임에 따라간다
SIG = 0            # 앞뒤를 같이 보는 다듬기는 안 쓴다 - σ 0.05초도 카메라를 한두 프레임 먼저 움직였다. 떨림은 DZ_* 와 가속 한도가 받는다
EDGE_M = 0.01      # 줌아웃은 몸이 이 여백까지 넘을 때만 (화면 밖으로 나가려 할 때)
# 사용자 "아직도 너무 어지러워 순간적으로 크게 움직이는 이동, 줌인, 아웃이 많으면 어지러우니까 크게 변경되는 경우 오히려 천천히 이동 해야 해
# 특히나 왔다 갔다 하는 경우라면 왔다 갔다 하는 기간 동안 최대 너비 까지 천천히 줌아웃 -> 이후에 다시 일반적으로 진행",
# "어떻게 처리하는지 내가 예시로 준 영상을 참고 해". 한도는 -1.mov 카메라 (0.1초마다) 의 99 백분위:
V_X, A_X = 0.31, 1.1   # 가로 속도 h/초 · 가속 h/초². measured 가운데값 0.037 · 90% 0.153 · 99% 0.314 / 가속 99% 1.10
V_Y, A_Y = 0.07, 0.3   # 세로. measured 속도 99% 0.072 (가속 guess)
V_Z, A_Z = 0.10, 0.3   # 배율 바뀜 /초. measured 99% 0.099 · 최대 0.22 (가속 guess). 다리 차기 64-70초: 2.5초에 걸쳐 7% 넓히고 그대로
DZ_X = 0.025      # 가로: 몸 무게중심이 카메라 가운데에서 너비의 이만큼 안에서 흔들리면 안 따라간다 (넘으면 그 끝을 따라감).
                   # measured -1.mov 카메라-몸 가로 차 사분위 -0.025 ~ 0.015 - 참고본도 이 폭의 흔들림은 안 따라간다
DZ_Y = 0.02        # 세로도 같은 방식 (guess)
DZ_H = 0.03        # 배율도 3% 안의 바뀜은 안 따라간다 - 여백(HEAD · FOOT · SIDE) 이 받아 준다 (guess)
FILL = 0.8         # 캐릭터가 화면을 이만큼은 채운다 - 사용자 "너무 줌아웃이 많이 되면 안돼 8:2 (캐릭터 : 여백)까지만 허용 그이상은 허용하지 않음".
                   # 몸 높이 · 너비 중 더 꽉 차는 쪽으로 잰다. 왔다 갔다 구간은 그때까지 오간 폭이 캐릭터 ("25~27초는 잘 처리 했는데")
ZWIN = 0.5         # 배율: 지난 이만큼 동안 필요했던 가장 넓은 배율을 쥐고 있다 (2.5초로는 차기가 끝난 27-29초가 "일반적인 경우 ... 다시 줌인을 해서 여백을
#                   최소화" 되지 않았다 -> 0.5초. 차기 사이사이는 왔다 갔다 구간이 막는다) - 차기 사이사이 줌인하지 않게. measured 참고본 배율 바뀜은
                   # 가운데값 초당 0.2% (거의 고정), 이 판 앞은 5% 였다. 지난 것만 보므로 미리 넓히지 않는다 (guess 1.5초)
OSC_X = 0.05       # 왔다 갔다: 무게중심이 너비의 이만큼 넘게 오가는 꺾임
OSC_Z = 0.08       # 또는 필요한 배율이 이만큼 넘게 솟는 봉우리
OSC_GAP, OSC_N = 0.6, 4   # 꺾임 · 봉우리가 0.6초 안 간격으로 4번 넘게 이어지면 왔다 갔다 구간. measured 시험 40-70초: 다리 차기
                          # 65.2-67.2초는 0.2-0.5초 간격으로 13번, 다른 곳은 0.6초 넘게 떨어지거나 2-3번 (1초 · 3번으로는 56-68초가 한 덩이)
SIDE = 0.03        # 몸 끝과 상자 가장자리 사이 최소 여유 / 너비 (guess)
TOL = 0.4          # 키를 뺄 때 직선에서 벗어나도 되는 정도 (원본 px)
PUNCH_Z = 2.0      # 챌린지 확대 배율 (guess - 상반신이 차는 정도)
PUNCH_HEAD = 0.14  # 확대 중 머리 위 여백. measured R14ZVrYoWSs 19.2-23.2초 (4.0초, 컷 인 · 컷 아웃): 0.14
HMIN = 0.45        # 상자 높이 최소 (원본 높이 비율) - 너무 당기면 흐리다 (guess)

work = os.path.abspath(sys.argv[1])
E = json.load(io.open(os.path.join(work, "edit.json"), encoding="utf-8"))
SRC = E["source"] if os.path.isabs(E["source"]) else os.path.join(work, E["source"])
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
js = ("import {loadPreset} from 'file:///%s/shortsmith/lib/preset.mjs';"
      "const r=loadPreset(process.argv[1], process.argv[2]);process.stdout.write(JSON.stringify({w:r.preset.layout.window,c:r.preset.camera||{}}))") % ROOT.replace(os.sep, "/")
PR = json.loads(subprocess.run(["node", "--input-type=module", "-e", js, E["preset"], work], capture_output=True, text=True, check=True).stdout)
Wn, PCAM = PR["w"], PR["c"]
ASP = Wn["w"] / Wn["h"]
pr = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,duration",
                     "-of", "csv=p=0", SRC], capture_output=True, text=True).stdout.strip().split(",")
SW, SH, DUR = int(pr[0]), int(pr[1]), float(pr[2])


def keep_ranges():
    K = E.get("keep") or [[0, DUR]]
    out = []
    for k in K:
        if isinstance(k, dict):
            if k.get("gap") or k.get("source"):
                continue
            out.append((k["s"], k["e"]))
        else:
            out.append((k[0], k[1]))
    return out


# ---- 1. 캐릭터: 0.2초마다 윤곽 (isnet), 그 사이는 광학 흐름으로 프레임마다 ----
def masks_isnet():
    """FPS 마다 몸 윤곽 (MW x MH bool). 편 폴더 char_masks.npz 에 캐시"""
    st = os.stat(SRC)
    key = json.dumps({"src": SRC.replace(os.sep, "/"), "size": st.st_size, "mtime": int(st.st_mtime), "fps": FPS, "w": MW, "v": 3})
    cache = os.path.join(work, "char_masks.npz")
    have = {}
    if os.path.exists(cache):
        z = np.load(cache)
        if str(z["key"]) == key:
            have = {round(float(t), 3): np.unpackbits(b)[:MW * MH].reshape(MH, MW).astype(bool) for t, b in zip(z["t"], z["m"])}
    want = sorted({round(round(t * FPS) / FPS, 3) for s, e in keep_ranges()
                   for t in np.arange(max(0, s - 0.4), min(DUR, e + 0.4), 1 / FPS)})
    todo = [t for t in want if t not in have]
    if todo:
        import cv2, onnxruntime as ort
        sess = ort.InferenceSession(os.path.expanduser("~/.u2net/isnet-anime.onnx"), providers=["CPUExecutionProvider"])
        W, H = 1024, int(round(1024 * SH / SW))
        groups, g = [], [todo[0]]                  # 이어진 덩이마다 ffmpeg 한 번
        for t in todo[1:]:
            if t - g[-1] > 1.5 / FPS:
                groups.append(g); g = [t]
            else:
                g.append(t)
        groups.append(g)
        done = 0
        for g in groups:
            p = subprocess.Popen(["ffmpeg", "-v", "error", "-ss", "%.3f" % g[0], "-i", SRC, "-t", "%.3f" % (g[-1] - g[0] + 0.5 / FPS),
                                  "-vf", "fps=%d,scale=%d:%d" % (FPS, W, H), "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], stdout=subprocess.PIPE)
            for t in g:
                b = p.stdout.read(W * H * 3)
                if len(b) < W * H * 3:
                    break
                f = np.frombuffer(b, np.uint8).reshape(H, W, 3)
                im = cv2.resize(f, (1024, 1024)).astype(np.float32) / 255 - np.array([0.485, 0.456, 0.406], np.float32)
                o = sess.run(None, {"img": im.transpose(2, 0, 1)[None]})[0][0, 0]
                o = (o - o.min()) / (o.max() - o.min() + 1e-9)
                m = (cv2.resize(o, (W, H)) > 0.5).astype(np.uint8)
                n, lab, s_, _ = cv2.connectedComponentsWithStats(m)
                out = np.zeros((H, W), bool)
                if n > 1:
                    k = 1 + int(np.argmax(s_[1:, cv2.CC_STAT_AREA]))
                    bx0, bx1 = s_[k, 0], s_[k, 0] + s_[k, 2]
                    # 떨어진 손 · 머리칼은 넣고, 몸 밖의 큰 덩이는 뺀다 - 구독 · 후원 알림의 치비 그림을 몸으로 잡았다
                    # (Damyui-n152 7.9-14.2초: 몸 왼쪽 0.3 너비 옆, 몸 넓이의 20% 넘음)
                    by0, by1, bh = s_[k, 1], s_[k, 1] + s_[k, 3], s_[k, 3]
                    def near(j, pad):
                        return (s_[j, 0] < bx1 + pad and s_[j, 0] + s_[j, 2] > bx0 - pad and
                                s_[j, 1] < by1 + pad and s_[j, 1] + s_[j, 3] > by0 - pad)
                    A = s_[k, cv2.CC_STAT_AREA]
                    keep = [k] + [j for j in range(1, n) if j != k and s_[j, cv2.CC_STAT_AREA] > 0.01 * A and
                                  (near(j, 0) if s_[j, cv2.CC_STAT_AREA] > 0.1 * A else near(j, 0.15 * bh))]
                    out = np.isin(lab, keep)
                have[t] = cv2.resize(out.astype(np.uint8), (MW, MH), interpolation=cv2.INTER_NEAREST).astype(bool)
                done += 1
                if done % 50 == 0:
                    print("  윤곽 %d/%d" % (done, len(todo)), flush=True)
            p.kill()
        ts = sorted(have)
        np.savez_compressed(cache, key=key, t=np.array(ts), m=np.array([np.packbits(have[t].ravel()) for t in ts]))
    return {t: have[t] for t in want if t in have}


def stats(pts):
    """점들 -> [x0, y0, x1, y1, 무게중심 x, 머리 꼭대기 y, 상반신 무게중심 x] (원본 px). 끝은 0.5 / 99.5 백분위 - 흐름이 튄 점
    몇 개에 안 끌려가게. 머리 꼭대기 = 무게중심 둘레 띠 (몸 높이의 0.08 양옆) 의 윤곽 꼭대기 - 팔을 들면 손이 몸 상자 꼭대기가 된다.
    상반신 = 머리 꼭대기부터 몸 높이의 0.35 까지. 뒤 두 칸은 C:D 클로즈업 (dance_beats.py) 이 쓴다"""
    if len(pts) < 20:
        return [np.nan] * 7
    sc = SW / MW
    x0, x1 = np.percentile(pts[:, 0], [0.5, 99.5]); y0, y1 = np.percentile(pts[:, 1], [0.5, 99.5])
    cx, bh = pts[:, 0].mean(), y1 - y0
    band = pts[np.abs(pts[:, 0] - cx) < 0.08 * bh]
    hy = np.percentile(band[:, 1], 0.5) if len(band) >= 10 else y0
    up = pts[pts[:, 1] < hy + 0.35 * bh]
    ux = up[:, 0].mean() if len(up) >= 10 else cx
    return [x0 * sc, y0 * sc, x1 * sc, y1 * sc, cx * sc, hy * sc, ux * sc]


from concurrent.futures import ThreadPoolExecutor
POOL = ThreadPoolExecutor(8)       # cv2 는 GIL 을 놓는다 - measured Farneback 480x270 19.8 -> 5.0ms/장 (i7-1260P)


def dense():
    """DFPS 마다 몸 [x0, y0, x1, y1, cx]. 윤곽이 있는 시각은 윤곽 그대로, 그 사이는 앞 윤곽의 점을 흐름대로 앞으로 옮긴 것과
    뒤 윤곽의 점을 거꾸로 옮긴 것을 시간 비율로 섞는다 (한쪽만 쓰면 0.2초 사이에 흐름 오차가 쌓인다)"""
    import cv2
    M = masks_isnet()
    mt = np.array(sorted(M))
    T, V = [], []
    for s, e in keep_ranges():
        a0 = max(0.0, round(round((s - 0.2) * FPS) / FPS, 3))
        dur = min(DUR, e + 0.4) - a0
        raw = subprocess.run(["ffmpeg", "-v", "error", "-ss", "%.3f" % a0, "-i", SRC, "-t", "%.3f" % dur, "-vf",
                              "fps=%d,scale=%d:%d,format=gray" % (DFPS, MW, MH), "-f", "rawvideo", "-"], capture_output=True).stdout
        F = np.frombuffer(raw, np.uint8).reshape(-1, MH, MW)
        ft = a0 + np.arange(len(F)) / DFPS
        flow = lambda ij: cv2.calcOpticalFlowFarneback(F[ij[0]], F[ij[1]], None, 0.5, 3, 21, 3, 5, 1.1, 0)
        anchors = [(int(round((t - a0) * DFPS)), t) for t in mt if a0 - 1e-6 <= t <= ft[-1] + 1e-6]
        vals = np.full((len(F), 7), np.nan)
        for ia, ta in anchors:
            vals[ia] = stats(np.argwhere(M[ta])[:, ::-1].astype(np.float32))
        for (ia, ta), (ib, tb) in zip(anchors, anchors[1:]):
            if ib - ia < 2:
                continue
            fw = {}
            # 이 구간에 쓸 흐름 (앞으로 · 뒤로) 을 스레드 8개로 먼저 - 한 줄로 돌리면 23초 (허니하트 1160번), 나눠 돌려도 값은 같다
            need = [(i, i + 1) for i in range(ia, ib - 1)] + [(i, i - 1) for i in range(ib, ia + 1, -1)]
            FL = dict(zip(need, POOL.map(flow, need)))
            p = np.argwhere(M[ta])[::3, ::-1].astype(np.float32)
            for i in range(ia, ib - 1):
                fl = FL[(i, i + 1)]
                q = np.clip(p.round().astype(int), 0, [MW - 1, MH - 1])
                p = p + fl[q[:, 1], q[:, 0]]
                fw[i + 1] = stats(p)
            p = np.argwhere(M[tb])[::3, ::-1].astype(np.float32)
            for i in range(ib, ia + 1, -1):
                fl = FL[(i, i - 1)]
                q = np.clip(p.round().astype(int), 0, [MW - 1, MH - 1])
                p = p + fl[q[:, 1], q[:, 0]]
                u = (i - 1 - ia) / (ib - ia)
                vals[i - 1] = (1 - u) * np.array(fw[i - 1]) + u * np.array(stats(p))
        keep = (ft >= s - 1e-6) & (ft <= e + 1e-6)
        T.extend(ft[keep]); V.extend(vals[keep])
    T, V = np.array(T), np.array(V)
    for c in range(V.shape[1]):                    # 못 찾은 칸은 이웃으로
        ok = ~np.isnan(V[:, c])
        V[:, c] = np.interp(T, T[ok], V[ok, c])
    return T, V


T, B = dense()
x0, y0, x1, y1, mcx = B[:, :5].T

# ---- 2. 카메라 ----
# 작은 움직임은 몸과 같은 프레임에, 큰 움직임은 참고본의 속도 · 가속 한도 안에서 천천히 (넘치는 만큼만 늦는다 - 미리 움직이지는 않는다).
# 왔다 갔다 하는 구간은 그 동안 몸이 오가는 전체 폭이 들어가게 천천히 넓혀 두고, 끝나면 다시 평소대로.
cam = E.get("camera") or {}
punch = cam.get("punch") or []
sg = lambda a, sec: gaussian_filter1d(a, sec * DFPS) if sec > 0 else a
X0, Y0, X1, Y1, MC = (sg(v, SIG) for v in (x0, y0, x1, y1, mcx))


def fit_h(bx0, by0, bx1, by1):
    """몸 상자가 여백까지 들어가는 상자 높이"""
    return np.clip(np.maximum((by1 - by0) / (1 - HEAD - FOOT), (bx1 - bx0) / (ASP * (1 - 2 * SIDE))), HMIN * SH, SH)


def aim(bx0, by0, bx1, by1, mc, h):
    """상자 높이 h 일 때 겨눌 가운데 x 와 위 y - 무게중심을 따르되 몸 끝이 안 나가게, 세로는 머리 · 발 여백이 고르게"""
    w = h * ASP
    lo, hi = bx1 - w / 2 + SIDE * w, bx0 + w / 2 - SIDE * w
    cx = np.where(lo <= hi, np.clip(mc, lo, hi), (lo + hi) / 2)
    top = ((by0 - HEAD * h) + (by1 + FOOT * h - h)) / 2
    return np.clip(cx, w / 2, SW - w / 2), np.clip(top, 0, SH - h)


# 왔다 갔다 하는 구간: 몸 무게중심 (가로) 이나 필요한 배율이 OSC_GAP 안 간격으로 OSC_N 번 넘게 방향을 바꾸는 곳
from scipy.signal import find_peaks
need = fit_h(X0, Y0, X1, Y1)
href = float(np.median(need))
ev = []
for sig, prom in ((MC, OSC_X * href * ASP), (-MC, OSC_X * href * ASP), (need, OSC_Z * href)):
    pk, info = find_peaks(sig, prominence=prom)
    ev += [(int(i), int(b)) for i, b in zip(pk, info["left_bases"])]
ev.sort()
osc, g = [], []
for i, b in ev:
    if g and T[i] - T[g[-1][0]] > OSC_GAP:
        osc.append(g); g = []
    g.append((i, b))
if g:
    osc.append(g)
# 구간 = 첫 꺾임 0.3초 앞부터 마지막 꺾임까지 (봉우리 발치는 한참 앞까지 거슬러 가서 56-67초가 한 구간이 됐다)
osc = [(max(0, min(i for i, _ in g) - int(0.3 * DFPS)), max(i for i, _ in g)) for g in osc if len(g) >= OSC_N]
# 구간 안에서는 그때까지 실제로 오간 폭만 본다 (앞으로 갈 곳을 미리 보면 카메라가 동작보다 먼저 움직인다 - 사용자 "카메라 -> 동작은 절대 금지")
tx0, ty0, tx1, ty1, tmc = X0.copy(), Y0.copy(), X1.copy(), Y1.copy(), MC.copy()
in_osc = np.zeros(len(T), bool)
for a, b in osc:
    in_osc[a:b + 1] = True
    tx0[a:b + 1], ty0[a:b + 1] = np.minimum.accumulate(X0[a:b + 1]), np.minimum.accumulate(Y0[a:b + 1])
    tx1[a:b + 1], ty1[a:b + 1] = np.maximum.accumulate(X1[a:b + 1]), np.maximum.accumulate(Y1[a:b + 1])
    tmc[a:b + 1] = (tx0[a:b + 1] + tx1[a:b + 1]) / 2
# 배율 겨냥: 몸이 지금 화면을 넘을 때만 넓힌다 ("동작이 화면 밖으로 나가기 전까지는 줌아웃하면 안돼") - 여백 EDGE_M 만 두고 딱 들어가게.
# 당기기는 지난 ZWIN 의 풀샷 높이가 지금보다 DZ_H 넘게 작을 때만, 왔다 갔다 구간 안에서는 안 당긴다
need_edge = np.clip(np.maximum((ty1 - ty0) / (1 - 2 * EDGE_M), (tx1 - tx0) / (ASP * (1 - 2 * EDGE_M))), HMIN * SH, SH)
nf_hold = np.array([need[max(0, i - int(ZWIN * DFPS)):i + 1].max() for i in range(len(need))])
H_aim, cur = np.empty(len(T)), float(need[0])
for i in range(len(T)):
    if need_edge[i] > cur:
        cur = float(need_edge[i])
    elif not in_osc[i] and nf_hold[i] < cur * (1 - DZ_H):
        cur = float(nf_hold[i])
    H_aim[i] = cur





def dead(target, band):
    """band 안의 흔들림은 무시 - 밖으로 나가면 그 끝을 따라간다 (지난 값만 쓴다)"""
    out, c = np.empty(len(target)), float(target[0])
    for i, tg in enumerate(target):
        c = min(max(c, tg - band[i]), tg + band[i])
        out[i] = c
    return out

def follow(target, vmax, amax, scale):
    vmax, amax = np.broadcast_to(vmax, target.shape), np.broadcast_to(amax, target.shape)
    """target 을 따라간다. 속도 vmax · 가속 amax (scale 곱) 안이면 같은 프레임에 딱 맞고, 넘치면 그만큼만 천천히.
    멈출 거리를 봐서 넘어가지 않게 줄인다. 앞 프레임 값만 쓴다 (미리 움직이지 않는다)"""
    dt = 1.0 / DFPS
    c, v, out = float(target[0]), 0.0, np.empty(len(target))
    for i, tg in enumerate(target):
        vm, am = vmax[i] * scale[i], amax[i] * scale[i]
        e = tg - c
        vd = np.sign(e) * min(vm, np.sqrt(2 * am * abs(e)), abs(e) / dt)
        v += np.clip(vd - v, -am * dt, am * dt)
        c2 = c + v * dt
        if (c2 - tg) * (c - tg) < 0:                # 목표를 지나치지 않는다 - 줌이 몸보다 2px 넓어진 적이 있다
            c2, v = float(tg), 0.0
        c = c2
        out[i] = c
    return out


# 줌도 참고본 한도 그대로 (앞 판은 왔다 갔다 구간에서 빠르기를 올려 "줌아웃이 너무 빠르고")
# 8:2 한도: 캐릭터(구간 안은 오간 폭)가 그 프레임 화면의 FILL 아래로 작아지면 안 된다 (지난 0.3초로 재니 웅크릴 때 0.66 까지 내려갔다)
ext = np.maximum(ty1 - ty0, (tx1 - tx0) / ASP)
H_cap = np.clip(ext / FILL, HMIN * SH, SH)
H = np.clip(np.minimum(follow(np.minimum(H_aim, H_cap), V_Z, A_Z, H_aim), H_cap), HMIN * SH, SH)
CX_aim, TOP_aim = aim(tx0, ty0, tx1, ty1, tmc, H)
CX = follow(dead(CX_aim, DZ_X * H * ASP), V_X, A_X, H)
TOP = follow(dead(TOP_aim, DZ_Y * H), V_Y, A_Y, H)
Wd = H * ASP
CX = np.clip(CX, Wd / 2, SW - Wd / 2)
TOP = np.clip(TOP, 0, SH - H)
X = CX - Wd / 2
BASE = href

# C:D (프리셋 camera.mode "dynamic"): 위 트래킹을 베이스로 비트에 맞춰 컷 인 · 밀기 · 빼기 · 순간 확대 (tools/dance_beats.py)
CUT, DYN = np.zeros(len(T), bool), None
if PCAM.get("mode") == "dynamic":
    import dance_beats
    X, TOP, H, CUT, DYN = dance_beats.plan(T, B, (X, TOP, H), dict(
        SW=SW, SH=SH, ASP=ASP, DFPS=DFPS, follow=follow, dead=dead, src=SRC, work=work,
        DZ_X=DZ_X, DZ_Y=DZ_Y, V_X=V_X, A_X=A_X, V_Y=V_Y, A_Y=A_Y))

# 거의 직선인 키는 뺀다 (Douglas-Peucker, x · y · h 가 TOL 안)
def simplify(i, j, out):
    if j <= i + 1:
        return
    u = (T[i + 1:j] - T[i]) / (T[j] - T[i])
    err = np.max(np.abs(np.stack([X[i + 1:j] - (X[i] + (X[j] - X[i]) * u), TOP[i + 1:j] - (TOP[i] + (TOP[j] - TOP[i]) * u),
                                  H[i + 1:j] - (H[i] + (H[j] - H[i]) * u)])), axis=0)
    k = i + 1 + int(np.argmax(err))
    if err[k - i - 1] > TOL:
        simplify(i, k, out); out.append(k); simplify(k, j, out)

box = lambda i: {"x": round(float(X[i]), 1), "y": round(float(TOP[i]), 1), "h": round(float(H[i]), 1)}
keys = []
segs = [0] + [i for i in range(1, len(T)) if CUT[i]] + [len(T)]
for a, b in zip(segs, segs[1:]):                   # 컷마다 끊는다 - 조각 첫 키는 in 없이 (그 프레임에 컷)
    idx = [a]
    simplify(a, b - 1, idx)
    idx = sorted(set(idx + [b - 1]))
    keys += [dict(t=round(float(T[idx[0]]), 3), **box(idx[0]))] + [dict(t=round(float(T[i]), 3), **box(i), **{"in": "linear"}) for i in idx[1:]]

# 챌린지 순간 확대: 그 동안 상반신으로 컷 인 (고정), 끝나면 그 시각 트래킹 자리로 컷 아웃
for p in punch:
    s, e, z = p["s"], p["e"], p.get("z", PUNCH_Z)
    m = (T >= s) & (T < e)
    i1 = min(len(T) - 1, int(np.searchsorted(T, e)))
    h = max(HMIN * SH, H[i1] / z)
    w = h * ASP
    pc = {"x": round(float(np.clip(np.median(mcx[m]) - w / 2, 0, SW - w)), 1),
          "y": round(float(np.clip(np.min(y0[m]) - PUNCH_HEAD * h, 0, SH - h)), 1), "h": round(float(h), 1)}
    keys = [k for k in keys if not (s - 1e-6 <= k["t"] <= e + 1e-6)]
    keys.append(dict(t=round(s, 3), **pc))
    keys.append(dict(t=round(e, 3), **box(i1)))
    keys.sort(key=lambda k: k["t"])
    # 확대 바로 뒤 키가 확대 끝에서 이어지도록 (in 그대로), 확대 바로 앞은 그 자리에서 끊긴다 (컷)

# ---- 3. 검사 · 쓰기 ----
def cam_at(t):
    k0 = [k for k in keys if k["t"] <= t + 1e-6]
    a = k0[-1] if k0 else keys[0]
    nx = [k for k in keys if k["t"] > t + 1e-6]
    if nx and nx[0].get("in") == "linear":
        b = nx[0]; u = (t - a["t"]) / (b["t"] - a["t"])
        return {c: a[c] + (b[c] - a[c]) * u for c in ("x", "y", "h")}
    return a


clip = []
for t, b in zip(T, B):
    if not any(s <= t <= e for s, e in keep_ranges()) or any(p["s"] <= t < p["e"] for p in punch) or             (DYN is not None and DYN["kind"][int(np.argmin(abs(T - t)))] != "base"):
        continue                                   # 확대 · 클로즈업 중에는 몸이 잘리는 게 맞다
    k = cam_at(t)
    w = k["h"] * ASP
    over = max(k["x"] - b[0], b[2] - k["x"] - w, k["y"] - b[1], b[3] - k["y"] - k["h"])
    if over > 0.01 * k["h"]:
        clip.append((t, over / k["h"]))

cam["keys"] = keys
cam["basis"] = "tools/dance_camera.py 트래킹 (isnet-anime %dfps + 광학 흐름 %dfps, σ %.2f초, HEAD %.2f FOOT %.2f)" % (FPS, DFPS, SIG, HEAD, FOOT)
E["camera"] = cam
io.open(os.path.join(work, "edit.json"), "w", encoding="utf-8").write(json.dumps(E, ensure_ascii=False, indent=2) + "\n")
hs = [k["h"] for k in keys]
tot = sum(e - s for s, e in keep_ranges())
sp = np.abs(np.diff(CX)) * DFPS / H[1:]
print("왔다 갔다 구간 %d: %s" % (len(osc), ", ".join("%.1f-%.1f초" % (T[a], T[b]) for a, b in osc)))
print("카메라: 트래킹 키 %d (%.1f초) · 확대 %d · 배율 h %d-%d (가운데값 %d, 원본 %d) · 가로 속도 가운데값 %.3f / 95%% %.3f h/초"
      % (len(keys), tot, len(punch), min(hs), max(hs), BASE, SH, np.median(sp), np.percentile(sp, 95)))
if DYN is not None:
    print("비트: %.1f BPM · 박 %d · 마디 %d · 센스 %.0f%% (덩이 %d) · 순간 확대 %d번 · 컷 %d" % (DYN["bpm"], DYN["beats"], DYN["bars"],
          DYN["sense"] * 100, DYN["runs"], len(DYN["pulses"]), int(CUT.sum())))
    print("  손이 움직이는 시간 %.0f%%" % (DYN["hand_dyn"] * 100))
    print("  샷 시간: " + " · ".join("%s %.0f%%" % (k, v * 100) for k, v in DYN["shots"].items()))
print("몸이 잘리는 순간 (1%% 넘게): %d%s" % (len(clip), "" if not clip else "  " + ", ".join("%.1f초 %.0f%%" % (t, o * 100) for t, o in clip[:12])))

if "--sheet" in sys.argv:
    import cv2
    shots = []
    for t in np.arange(keep_ranges()[0][0], keep_ranges()[-1][1], 2.0):
        fr = subprocess.run(["ffmpeg", "-v", "error", "-ss", "%.2f" % t, "-i", SRC, "-frames:v", "1", "-vf", "scale=640:-2",
                             "-f", "rawvideo", "-pix_fmt", "bgr24", "-"], capture_output=True).stdout
        h6 = len(fr) // (640 * 3)
        im = np.frombuffer(fr, np.uint8).reshape(h6, 640, 3).copy()
        k, sc = cam_at(t), 640 / SW
        cv2.rectangle(im, (int(k["x"] * sc), int(k["y"] * sc)), (int((k["x"] + k["h"] * ASP) * sc), int((k["y"] + k["h"]) * sc)), (0, 255, 255), 2)
        i = int(np.argmin(abs(T - t)))
        cv2.rectangle(im, (int(B[i, 0] * sc), int(B[i, 1] * sc)), (int(B[i, 2] * sc), int(B[i, 3] * sc)), (255, 0, 255), 1)
        cv2.putText(im, "%.0f" % t, (6, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
        shots.append(im)
    while len(shots) % 4:
        shots.append(np.zeros_like(shots[0]))
    sheet = np.vstack([np.hstack(shots[r:r + 4]) for r in range(0, len(shots), 4)])
    ok, buf = cv2.imencode(".jpg", sheet, [cv2.IMWRITE_JPEG_QUALITY, 80])
    buf.tofile(os.path.join(work, "camera_sheet.jpg"))     # 한글 경로 - cv2.imwrite 는 조용히 실패한다
    print("camera_sheet.jpg")
