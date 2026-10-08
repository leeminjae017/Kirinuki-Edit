# -*- coding: utf-8 -*-
"""낱말 단위 전사 (2026-09-29 지시: "전사 다시 돌려서 앞으로는 단어 단위로 타임스탬프 찍어").

    ALLOW_AI=1 python tools/transcribe_words.py <편 폴더> [wav=src_loud.wav]
    python tools/transcribe_words.py <편 폴더> --from word_level_loud.json     # 이미 있는 전사에 2단계만 (AI 안 씀)

-> <편 폴더>/word_level_words.json (word_level_*.json 과 같은 꼴: [{start,end,text,words:[{start,end,word}]}])
   <편 폴더>/transcript_words.txt

1. whisper large-v3, word_timestamps, **VAD 없이.** 엔진은 tools/whisper_backend.py 가 고른다 - whisper.cpp
   (whisper-cli, 맥 Metal GPU) 가 있으면 그것, 없으면 faster-whisper (CPU). WHISPER_BACKEND=cpp|faster 로 고정. 위스퍼 낱말 시각은 쉼을 먹고 늘어난다
   ("그런 거 아니지" 의 "거" 가 18.86-21.54, 2.7초) - 그건 2단계가 고친다.
   VAD 를 켜 봤다가 버렸다 (퍼리 취향 2026-09-29, 잰 것): 낱말 90 -> 71, "사람은 아직 믿어?" · "아 맞다 나 단미지" x2 ·
   "나 단미였구나 그럼" 이 통째로 빠졌다 - 조용한 소스(-37 LUFS)의 여린 말을 VAD 가 쉼으로 읽는다.
2. 낱말 끝을 **소리가 있는 자리로 당긴다.** 편 폴더의 speech_map.json(말 덩이, 전대역 레벨)이 있으면 그것으로,
   없으면 여기서 전대역 -52/-60 dB 로 그린다. 낱말이 말 덩이 밖으로 0.15초 넘게 삐져나간 쪽만 깎는다
   (무성 마찰음 ㅅ·ㅆ·ㅎ 은 레벨에 안 보여서 - CLAUDE.md 컷 규칙 3 - 조금 넘는 것은 둔다). 0.05초는 여유로 남긴다.
재전사는 비싸다 (CLAUDE.md). ai_budget 이 막아 두었다 - 사용자 허락을 받고 ALLOW_AI=1 로 돌린다.
"""
import io, json, os, re, sys, wave

FROM = sys.argv[sys.argv.index("--from") + 1] if "--from" in sys.argv else None
if not FROM and os.environ.get("ALLOW_AI") != "1":
    sys.exit("재전사는 막혀 있다 (CLAUDE.md: 재전사 기본 0회). 사용자 허락을 받은 뒤 ALLOW_AI=1 을 붙인다.")

import numpy as np

work = os.path.abspath(sys.argv[1])
rest = [a for a in sys.argv[2:] if a != "--from" and a != FROM]
wav = rest[0] if rest else "src_loud.wav"
os.chdir(work)


def speech_chunks():
    if os.path.exists("speech_map.json"):
        return [tuple(x) for x in json.load(io.open("speech_map.json", encoding="utf-8"))], "speech_map.json"
    src = "src_audio.wav" if os.path.exists("src_audio.wav") else wav
    w = wave.open(src); sr = w.getframerate(); ch = w.getnchannels()
    x = np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(float) / 32768
    if ch > 1:
        x = x.reshape(-1, ch).mean(1)
    H = int(0.02 * sr); n = len(x) // H
    L = 20 * np.log10(np.sqrt((x[:n * H] ** 2).reshape(n, H).mean(1)) + 1e-9)
    # 문턱은 소스 바닥에 맞춘다 (2026-09-29): 고정 -52/-60 은 바닥이 -40 인 소스(야설 낭독회2 · 영도모캡랜디)에서
    # 소스 전체를 한 덩이로 읽어 낱말 맞춤이 헛돌았다 ("우리가" 를 0.8초 이르게 잡아 컷이 앞말 "말" 을 물었다).
    # 바닥(p10) + 7 / + 14 - 조용한 소스에서는 옛 값보다 낮아지지 않게 둔다
    floor = float(np.percentile(L, 10))
    WEAK, STRONG = max(-60.0, floor + 7), max(-52.0, floor + 14)
    on, runs, i = L > WEAK, [], 0
    while i < n:
        if on[i]:
            j = i
            while j + 1 < n and on[j + 1]:
                j += 1
            if L[i:j + 1].max() > STRONG:
                runs.append([i * 0.02, (j + 1) * 0.02])
            i = j + 1
        else:
            i += 1
    out = []
    for a, b in runs:
        if out and a - out[-1][1] < 0.30:
            out[-1][1] = b
        else:
            out.append([a, b])
    return [(round(a, 2), round(b, 2)) for a, b in out if b - a >= 0.10], "%s %.0f/%.0f (바닥 %.0f)" % (src, STRONG, WEAK, floor)


if FROM:
    out = json.load(io.open(FROM, encoding="utf-8"))
else:
    from whisper_backend import transcribe              # whisper.cpp (맥 Metal) 또는 faster-whisper - tools/whisper_backend.py
    out = transcribe(wav, language="ko")

CH, basis = speech_chunks()

# ---- 2. 낱말 시각을 말 토막에 글자를 나눠 담아 다시 잡는다 (tools/edit_audit/align.py 와 같은 방법) ----
# 위스퍼 구간을 말 덩이(speech_map)로 좁히고, 그 안을 잔 쉼(0.11초)으로 토막 낸 뒤 글자 수를 토막에 고른 속도로
# 나눠 담는다. 토막 길이는 잰 값, 글자 수는 아는 값이다. 낱말 경계는 그 음절 자리에서 나온다.
# 토막 안에서 음절은 고르게 놓는다 (짐작 - 한 토막 안의 속도 차는 못 본다).
def envelope(path, hop=0.01):
    w = wave.open(path); sr = w.getframerate(); ch = w.getnchannels()
    x = np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(float) / 32768
    if ch > 1:
        x = x.reshape(-1, ch).mean(1)
    H = int(hop * sr); n = len(x) // H
    e = 20 * np.log10(np.sqrt((x[:n * H] ** 2).reshape(n, H).mean(1)) + 1e-9)
    k = np.array([1, 2, 3, 2, 1], float); k /= k.sum()
    return np.convolve(e, k, "same")


HOP = 0.01
S = envelope("src_audio.wav" if os.path.exists("src_audio.wav") else wav)
THR = float(np.percentile(S, 20)) + 9      # 잡음 바닥 + 9dB (짐작 - 소스마다 바닥이 달라 고정값을 안 쓴다)
GAP, MINLEN = 0.11, 0.08
syl = lambda t: max(1, len(re.findall(u"[가-힣]", t)))


def subs(a, b):
    i0, i1 = int(a / HOP), min(len(S), int(b / HOP))
    on = S[i0:i1] > THR
    res, i = [], 0
    while i < len(on):
        if on[i]:
            j = i
            while j + 1 < len(on) and on[j + 1]:
                j += 1
            x, y = (i0 + i) * HOP, (i0 + j + 1) * HOP
            if res and x - res[-1][1] < GAP:
                res[-1][1] = y
            else:
                res.append([x, y])
            i = j + 1
        else:
            i += 1
    return [(x, y) for x, y in res if y - x >= MINLEN]


def split(chunks, N):
    C = len(chunks)
    dur = [e - s for s, e in chunks]
    rate = N / sum(dur)
    INF = 1e18
    best = [[INF] * (N + 1) for _ in range(C + 1)]
    back = [[0] * (N + 1) for _ in range(C + 1)]
    best[0][0] = 0
    for c in range(1, C + 1):
        for n in range(c, N - (C - c) + 1):
            for k in range(1, n - (c - 1) + 1):
                p = best[c - 1][n - k]
                if p < INF:
                    v = p + (dur[c - 1] - k / rate) ** 2
                    if v < best[c][n]:
                        best[c][n], back[c][n] = v, k
    take, n = [], N
    for c in range(C, 0, -1):
        k = back[c][n]; take.append(k); n -= k
    return list(reversed(take))


moved, total = 0, 0.0
for s in out:
    ws = s["words"]
    if not ws:
        continue
    a, b = ws[0]["start"], ws[-1]["end"]
    hit = [(x, y) for x, y in CH if y > a and x < b]
    if not hit:
        continue
    a2, b2 = max(a, hit[0][0]), min(b, hit[-1][1])
    if b2 - a2 < 0.1:
        continue
    ch = subs(a2, b2) or [(a2, b2)]
    counts = [syl(w["word"]) for w in ws]
    N = sum(counts)
    while len(ch) > N:                                  # 토막이 글자보다 많으면 가장 가까운 둘을 붙인다
        g = min(range(len(ch) - 1), key=lambda q: ch[q + 1][0] - ch[q][1])
        ch[g:g + 2] = [(ch[g][0], ch[g + 1][1])]
    take = split(ch, N)
    sy = []
    for (x, y), k in zip(ch, take):
        for q in range(k):
            sy.append((x + (y - x) * q / k, x + (y - x) * (q + 1) / k))
    off = 0
    for w, k in zip(ws, counts):
        na, nb = round(sy[off][0], 2), round(sy[off + k - 1][1], 2)
        off += k
        d = abs(na - w["start"]) + abs(nb - w["end"])
        if d > 0.02:
            moved += 1; total += d
        w["whisper"] = [w["start"], w["end"]]           # 위스퍼 원래 시각도 남겨 둔다
        w["start"], w["end"] = na, nb
    s["start"], s["end"] = ws[0]["start"], ws[-1]["end"]

json.dump(out, io.open("word_level_words.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
io.open("transcript_words.txt", "w", encoding="utf-8").write("\n".join(
    "%7.2f - %7.2f  %s" % (w["start"], w["end"], w["word"].strip()) for s in out for w in s["words"]))
nw = sum(len(s["words"]) for s in out)
print("segments %d · words %d · 시각을 옮긴 낱말 %d (옮긴 합 %.2f초) · 말 덩이 %s · 토막 문턱 %.1fdB" % (len(out), nw, moved, total, basis, THR))
