# -*- coding: utf-8 -*-
"""완성본만 보고 하는 검사 (재편집 2026-09-27).
1) 자막 줄마다 - 그 시각 앞뒤로 말이 어디서 시작하는지 (자막이 이른가 늦은가)
2) 이음매마다 - 컷 바로 앞뒤 0.12초가 조용한지 (낱말을 잘랐는가)
잰 것만 찍는다. 전사를 쓰지 않는다.
"""
import csv, json, sys, wave, numpy as np

W = wave.open("fin_audio.wav", "rb")
sr = W.getframerate()
x = np.frombuffer(W.readframes(W.getnframes()), dtype="<i2").astype(np.float32) / 32768
H = int(0.01 * sr)                      # 10ms 칸
n = len(x) // H
rms = np.sqrt(np.maximum(1e-12, (x[: n * H] ** 2).reshape(n, H).mean(1)))
db = 20 * np.log10(rms)
def d(t):                               # 초 -> dB
    i = int(round(t / 0.01))
    return float(db[min(max(i, 0), n - 1)])
SPEED = json.load(open("edit.json", encoding="utf-8")).get("speed", 1.0)
KEEP = json.load(open("edit.json", encoding="utf-8"))["keep"]

pct = np.percentile(db, [5, 30, 50, 70, 95])
print("레벨 분포 5/30/50/70/95%%: %s" % " ".join("%.1f" % v for v in pct))
# 말 문턱은 분포의 두 봉우리 가운데로 잡는다. p60 으로 잡으면 조용한 소스에서 여린 음절이 통째로
# "말 없음" 으로 읽힌다 (퍼리 취향 1차: -37 LUFS 소스, p60 이 -18.9 라 -19.7 인 "나" 를 못 봤다)
VOICE = float((pct[0] + pct[4]) / 2)    # (p5 + p95) / 2
SIL = float(pct[0] + 6)
print("말 문턱 %.1f dB · 조용 문턱 %.1f dB" % (VOICE, SIL))

def onset(t0, t1):                      # [t0,t1) 안에서 말이 처음 서는 자리 (연속 3칸)
    i0, i1 = int(t0 / 0.01), int(t1 / 0.01)
    for i in range(max(0, i0), min(n - 3, i1)):
        if db[i] > VOICE and db[i + 1] > VOICE and db[i + 2] > VOICE:
            return i * 0.01
    return None

rows = list(csv.DictReader(open("captions.csv", encoding="utf-8-sig")))
lines = [r for r in rows if r["speaker"] != "제목"]
hms = lambda s: sum(f * float(v) for f, v in zip((3600, 60, 1), s.split(":")))
bad = []
# 줄을 두 가지로만 본다. 앞 판은 "줄 시각 앞 0.5초부터 말 시작 찾기" 였는데 말이 이어지는 가운데 줄은
# 창 첫 칸에서 걸려 전부 -0.5 로 나왔다 (헛경보 20건). 지금 보는 것:
#  1) 빈 자리에 뜬 자막 - 뜬 뒤 0.35초 안에 말이 없다
#  2) 낱말 가운데에 뜬 자막 - 앞 0.3초가 내내 말이고 ±0.15 안에 골(주변보다 6dB 이상 낮은 칸)이 없다
print("")
print("[자막] 줄 시각(완성본) · 뜬 뒤 0.35초 최대 · 가까운 골")
for r in lines:
    t = hms(r["start"]) / SPEED
    after = max(db[int(t / 0.01) : int((t + 0.35) / 0.01)])
    w0, w1 = max(0, int((t - 0.15) / 0.01)), int((t + 0.15) / 0.01)
    loc = db[w0:w1]
    dip = (w0 + int(np.argmin(loc))) * 0.01
    before = min(db[int((t - 0.30) / 0.01) : int(t / 0.01)]) if t > 0.3 else -99
    flag = ""
    if after < VOICE:
        flag = "  <== 빈 자리 (뜬 뒤 0.35초 말 없음)"
    elif before > VOICE and d(dip) > float(np.mean(loc)) - 6:
        flag = "  <== 낱말 가운데 (앞뒤로 골이 없다)"
    if flag:
        bad.append((t, r["text"], None, flag.strip()))
    print("  %6.2f  %-24s 뒤 %5.1f  골 %+.2f(%.0f)%s" % (t, r["text"], after, dip - t, d(dip), flag))

print("\n[이음매] 컷 자리 앞뒤 0.05초 최대 레벨 (말 문턱 %.1f 넘으면 낱말을 물었을 수 있다)" % VOICE)
# 이음매 창은 0.05초. 조각 가장자리 여백을 0.10-0.13초로 두므로 0.12초 창은 그 여백 뒤에 오는 말을
# 늘 잡아 헛경보가 난다 (퍼리 취향 1차에서 이음매 11 곳 중 5 곳). 낱말을 문 컷은 컷에 붙어 소리가 난다
PAD = 0.05
acc = 0.0
joins = []
for k in KEEP[:-1]:
    acc += k["e"] - k["s"]
    joins.append(acc / SPEED)
for j in joins:
    a = max(db[max(0, int((j - PAD) / 0.01)) : int(j / 0.01)]) if j > PAD else -99
    b = max(db[int(j / 0.01) : int((j + PAD) / 0.01)])
    f = "  <== " + ("앞뒤 다" if a > VOICE and b > VOICE else "앞" if a > VOICE else "뒤") + " 말 중" if (a > VOICE or b > VOICE) else ""
    if f:
        bad.append((j, "이음매", None, f.strip()))
    print("  %6.2f  앞 %.1f  뒤 %.1f%s" % (j, a, b, f))

print("\n문제 %d건" % len(bad))
for t, txt, gap, f in bad:
    print("  %6.2f  %-24s %s" % (t, txt, f))
