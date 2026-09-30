# -*- coding: utf-8 -*-
"""대시보드 피드백 탭의 자막 -> shortsmith 편 폴더 (AI 없는 "렌더" 단추가 부른다).

    python tools/apply_review.py <편 폴더> <projects/<id>/project.json>

- review.captions (완성본 시각) 를 edit.json 의 captionClock 에 맞춰 captions.csv 로 쓴다 (덮기 전에 captions.csv.bak)
- 고친 줄(orig -> text)을 가리키는 fx.json 값(kinds 열쇠 · images/labels/inserts/fx 의 from/to/at)도 새 글로 바꾼다.
  fx 는 자리를 자막 글로 적어서, 글을 고치면 연출이 제 줄을 못 찾아 렌더가 멈춘다
- **컷(되살리기 · 빼기)도 반영한다** (사용자 2026-09-29: 미리보기에서 들은 컷 그대로 렌더). 굽지 않은 미리보기와 **같은 계산**이다
  (dashboard/js/feedback.js plan() · planScene() · toPlanT()): 남길 원본 구간 = 지금 조각 - 뺄 말 + 되살릴 말,
  조각 경계에서 나눠 조각마다 크롭 · 이득을 물려받는다 (되살린 틈은 앞 조각 크롭, 이득 0).
  edit.json 의 keep 을 그 구간으로 바꾸고(덮기 전 edit.json.bak), 자막 · fx.json 숫자 시각을 새 편집 시각으로 옮긴다.
  말이 다 빠진 자막 줄은 버리고, 되살린 자리 자막(review.restoreCaps)은 줄로 넣는다.
  컷을 바꿨으면 "CUTS CHANGED" 를 찍는다 - 서버가 shortsmith cuts 를 먼저 돌린다 (build 는 있는 cuts.json 을 그냥 쓴다)
"""
import csv, io, json, os, shutil, sys

work, pj = os.path.abspath(sys.argv[1]), sys.argv[2]
R = (json.load(io.open(pj, encoding="utf-8")).get("review") or {})
os.chdir(work)
E = json.load(io.open("edit.json", encoding="utf-8"))
caps = R.get("captions") or []
if not caps:
    sys.exit("피드백 탭에 자막이 없습니다")
clock, speed = E.get("captionClock", "output"), float(E.get("speed") or 1)
if clock == "source":
    sys.exit("captionClock 이 source 인 편은 렌더 단추로 못 굽습니다 (편집으로)")
k = speed if clock == "timeline" else 1.0

# ---- 컷: 되살리기 · 빼기 · 리플 (feedback.js 와 같은 계산) ----
EDGE = 0.15
W = [w for sg in (R.get("transcript") or []) for w in (sg.get("words") or [])]


def ranges(flag):
    out = []
    for w in W:
        if not flag(w):
            continue
        if out and w["s"] - out[-1][1] < 0.30:
            out[-1][1] = w["e"]
        else:
            out.append([w["s"], w["e"]])
    return [[round(a, 3), round(b, 3)] for a, b in out]


RS = ranges(lambda w: w.get("restore") and not w.get("drop"))
DS = ranges(lambda w: w.get("drop"))
K = R.get("clips") or []
PIECES = json.load(io.open("cuts.json", encoding="utf-8"))["pieces"] if os.path.exists("cuts.json") else []
MAIN = [pc for pc in PIECES if not pc.get("gap")]          # 빈 틈 조각(리플 끔)은 대시보드 조각이 아니다
CUT = bool((RS or DS) and K and len(MAIN) == len(K))
if (RS or DS) and not CUT:
    print("알림: 되살리기/빼기가 있지만 조각 목록이 cuts.json 과 안 맞아 컷은 반영하지 않습니다 - '편집'(AI)으로 넘기세요")
RPAD0, RPAD1 = 0.10, 0.15                      # 되살린 말 앞뒤 여유 - feedback.js 와 같아야 한다
# 리플 (2026-09-30, feedback.js ripple()): 켜면 뺀 자리를 당기고 되살린 만큼 뒤를 민다. 끄면 뒤 시각이 그대로 -
# 뺀 자리는 빈 틈(edit.json keep 의 { gap }, 검은 창 · 무음), 되살린 말은 옆 내용을 덮어쓴다
RIP = R.get("ripple") is not False
# 남길 구간 [원본 시작, 원본 끝, 편집 시각] (feedback.js plan() 과 같은 계산)
P = [[c["s"], c["e"], c["os"]] for c in K]
if CUT:
    S = [[c["s"], c["e"], c["os"], False] for c in K]
    for d in DS:
        Q = []
        for r in S:
            if d[1] <= r[0] or d[0] >= r[1]:
                Q.append(r); continue
            if d[0] > r[0] + 0.01: Q.append([r[0], d[0], r[2], True])
            if d[1] < r[1] - 0.01: Q.append([d[1], r[1], r[2] + (d[1] - r[0]), True])
        S = Q
    # 빼고 남은 토막에 남은 말이 없으면 버린다 (feedback.js plan() 과 같다)
    WS = [w for w in W if (not w.get("drop")) and (w.get("restore") or w.get("keep"))]
    S = [r[:3] for r in S if not r[3] or any(min(w["e"], r[1]) - max(w["s"], r[0]) >= 0.5 * (w["e"] - w["s"]) for w in WS)]
    if RIP:                                    # 빠진 편집 시간만큼 뒤를 당긴다
        gone = []
        for c in K:
            cur = c["os"]
            for r in [r for r in S if c["os"] - 0.001 <= r[2] < c["oe"] - 0.001]:
                if r[2] > cur + 0.001: gone.append((cur, r[2]))
                cur = r[2] + r[1] - r[0]
            if c["oe"] > cur + 0.001: gone.append((cur, c["oe"]))
        for r in S:
            x = r[2]
            r[2] -= sum(max(0.0, min(g1, x) - g0) for g0, g1 in gone)
    for r0 in RS:
        parts = [[max(0.0, r0[0] - RPAD0), r0[1] + RPAD1]]
        for r in S:                            # 이미 남은 원본은 빼고 새로 들어오는 토막만
            Q = []
            for q in parts:
                if r[1] <= q[0] or r[0] >= q[1]:
                    Q.append(q); continue
                if r[0] > q[0] + 0.001: Q.append([q[0], r[0]])
                if r[1] < q[1] - 0.001: Q.append([r[1], q[1]])
            parts = Q
        for a, b in parts:
            after = before = prev = None
            for r in S:
                if abs(r[1] - a) < 0.002: after = r
                if abs(r[0] - b) < 0.002: before = r
                if r[1] <= a + 0.002 and (prev is None or r[1] > prev[1]): prev = r
            at = after[2] + after[1] - after[0] if after else before[2] if before else (prev[2] + prev[1] - prev[0] if prev else 0.0)
            if RIP:                            # 끼워 넣고 뒤를 민다
                for r in S:
                    if r[2] >= at - 0.001: r[2] += b - a
            else:                              # 덮어쓴다 - 머리에 붙은 것은 앞쪽을
                if not after and before:
                    at -= b - a
                    if at < 0: a -= at; at = 0.0
                x0, x1, Q = at, at + b - a, []
                for r in S:
                    q0, q1 = r[2], r[2] + r[1] - r[0]
                    if q1 <= x0 + 0.001 or q0 >= x1 - 0.001:
                        Q.append(r); continue
                    if q0 < x0 - 0.02: Q.append([r[0], r[0] + (x0 - q0), q0])
                    if q1 > x1 + 0.02: Q.append([r[0] + (x1 - q0), r[1], x1])
                S = Q
            if b - a > 0.02: S.append([a, b, at])
    M = []
    for r in sorted(S):
        if M and abs(r[0] - M[-1][1]) < 0.002 and abs(r[2] - (M[-1][2] + M[-1][1] - M[-1][0])) < 0.002: M[-1][1] = r[1]
        else: M.append(list(r))
    P = M


def planned(t):                               # 원본 시각 -> 새 편집 시각 (feedback.js planned)
    best = None
    for r in P:
        if r[0] <= t < r[1]: return r[2] + (t - r[0])
        if r[1] <= t and (best is None or r[1] > best[1]): best = r
    return best[2] + best[1] - best[0] if best else 0.0


def to_src(t):
    r = None
    for c in K:
        if c["os"] - 0.02 <= t < c["oe"] - 0.02:
            r = c
    return r["s"] + (t - r["os"]) if r else None


def remap(x, end=False):                      # 지금 편집 시각 -> 컷을 반영한 편집 시각 (feedback.js toPlanT)
    if not CUT or not RIP:                    # 리플을 끄면 뒤 시각이 안 바뀐다
        return x
    q = x - EDGE if end else x
    sv = to_src(q)
    return x if sv is None else planned(sv) + (x - q)


def kept_of(s0, e0):                          # 자막 줄이 걸친 원본 구간 가운데 남는 길이 (feedback.js keptOf)
    a, b = to_src(s0), to_src(e0 - EDGE)
    if a is None or b is None:
        return 1.0
    b += EDGE
    return sum(max(0.0, min(b, r[1]) - max(a, r[0])) for r in P)


TOTAL = max(r[2] + r[1] - r[0] for r in P) if CUT else None
if CUT:
    keep, cur = [], 0.0
    for a, b, at in sorted(P, key=lambda r: r[2]):
        if at > cur + 0.01:
            keep.append({"gap": round(at - cur, 3)})      # 리플 끔 - 뺀 자리를 틈으로 남긴다
        elif at < cur:
            a += cur - at
        cur = max(cur, at + b - a)
        cuts = sorted({a, b} | {x for pc in MAIN for x in (pc["s"], pc["e"]) if a + 0.01 < x < b - 0.01})
        for x, y in zip(cuts, cuts[1:]):
            mid = (x + y) / 2
            inside = next((pc for pc in MAIN if pc["s"] <= mid < pc["e"]), None)
            near = inside or next((pc for pc in reversed(MAIN) if pc["s"] <= mid), None) or MAIN[0]
            ent = {"s": round(x, 3), "e": round(y, 3), "raw": True}
            if inside and inside.get("gainDb"):
                ent["gainDb"] = inside["gainDb"]
            if near.get("crop"):
                ent["crop"] = near["crop"]
            keep.append(ent)
    shutil.copyfile("edit.json", "edit.json.bak")
    E["keep"] = keep
    io.open("edit.json", "w", encoding="utf-8").write(json.dumps(E, ensure_ascii=False, indent=1) + chr(10))
    print("컷 반영 (리플 %s): 되살림 %d · 뺌 %d -> 조각 %d · %.2f초 (edit.json, 전 판은 edit.json.bak)"
          % ("켬" if RIP else "끔", len(RS), len(DS), len(keep), TOTAL))
    print("CUTS CHANGED")


def hms(t):
    t = max(0.0, t * k)
    return "%d:%02d:%05.2f" % (t // 3600, t % 3600 // 60, t % 60)


out = E.get("captions", "captions.csv")
if os.path.exists(out):
    shutil.copyfile(out, out + ".bak")
with io.open(out, "w", encoding="utf-8-sig", newline="") as f:
    w = csv.writer(f)
    # kind 칸(자막 디자인 이름)도 같이 쓴다 - 안 쓰면 렌더 단추 한 번에 모든 줄이 기본 자막이 된다
    w.writerow(["start", "end", "speaker", "kind", "text"])
    # 전체 자막 칸(두 축 타임라인)에서 고친 시작/끝은 s2 · e2 로 온다 - 그것이 있으면 그것을 쓴다
    def ts(c):
        return (c["s2"] if c.get("s2") is not None else c["s"],
                c["e2"] if c.get("e2") is not None else c["e"])

    rows, gone = [], {}
    for c in caps:
        s0, e0 = ts(c)
        txt = (c.get("text") or "").strip()
        if CUT:
            if (c.get("speaker") or "").strip() in ("제목", "title"):
                s0, e0 = 0.0, TOTAL
            else:
                s1, e1 = remap(s0), remap(e0, True)
                if e1 - s1 < 0.05 or kept_of(s0, e0) < 0.1:    # 이 줄의 말이 다 빠졌다
                    gone[txt] = s1
                    continue
                s0, e0 = s1, min(e1, TOTAL)
        if e0 - s0 < 0.01 and (c.get("speaker") or "").strip() not in ("제목", "title"):
            gone[txt] = s0                               # 피드백 탭에서 옆 줄에 덮여 길이 0 (롤 편집, 2026-09-30)
            continue
        rows.append((s0, e0, c.get("speaker") or "", c.get("kind") or "", txt))
    if CUT:                                              # 되살린 자리 자막 (피드백 탭 편집 쪽 초록 줄)
        for o in R.get("restoreCaps") or []:
            if (o.get("text") or "").strip() and o.get("src"):
                rows.append((planned(o["src"][0]), planned(o["src"][1]), o.get("speaker") or "담유이", o.get("kind") or "",
                             o["text"].strip()))
    for r in sorted(rows, key=lambda r: (r[2] not in ("제목", "title"), r[0])):
        w.writerow([hms(r[0]), hms(r[1]), r[2], r[3], r[4]])

# 빈 글로 바꾸는 것은 fx.json 에 옮기지 않는다 - 자막 줄을 지운 것이 채팅 카드 글까지 지워 버렸다
# (퍼리 취향 2026-09-28: 같은 시각에 자막 줄과 채팅 줄이 둘 다 있어 빈칸이 채팅 쪽에 먹었다)
ren = {c["orig"].strip(): c["text"].strip() for c in caps
       if c.get("orig") and (c.get("text") or "").strip() and c["orig"].strip() != c["text"].strip()}
n = 0
if ren and E.get("fx") and os.path.exists(E["fx"]):
    F = json.load(io.open(E["fx"], encoding="utf-8"))

    def sub(v):
        global n
        if isinstance(v, str) and v.strip() in ren:
            n += 1
            return ren[v.strip()]
        if isinstance(v, list):
            return [sub(x) for x in v]
        if isinstance(v, dict):
            return {(sub(a) if a in ren else a): sub(b) for a, b in v.items()}
        return v
    F = sub(F)
    shutil.copyfile(E["fx"], E["fx"] + ".bak")
    io.open(E["fx"], "w", encoding="utf-8").write(json.dumps(F, ensure_ascii=False, indent=1) + "\n")
# 컷을 바꿨으면 연출 시각도 옮긴다: 숫자로 적힌 from / to / at 은 새 편집 시각으로, 말이 다 빠져 사라진 자막 줄을
# 가리키던 것은 그 자리 시각(숫자)으로 바꾼다 - 안 그러면 build 가 "no caption" 으로 멈춘다
moved = 0
if (CUT or gone) and E.get("fx") and os.path.exists(E["fx"]):
    F = json.load(io.open(E["fx"], encoding="utf-8"))

    def mv(o):
        global moved
        for key in ("from", "to", "at"):
            v = o.get(key)
            if isinstance(v, (int, float)) and not isinstance(v, bool):
                o[key] = round(remap(v, key == "to"), 3); moved += 1
            elif isinstance(v, str) and v.strip() in gone:
                o[key] = round(gone[v.strip()], 3); moved += 1
    for lst in F.values():
        if isinstance(lst, list):
            for o in lst:
                if isinstance(o, dict):
                    mv(o)
    if isinstance(F.get("kinds"), dict):
        F["kinds"] = {t: v for t, v in F["kinds"].items() if t.strip() not in gone}
    if not os.path.exists(E["fx"] + ".bak") or not ren:
        shutil.copyfile(E["fx"], E["fx"] + ".bak")
    io.open(E["fx"], "w", encoding="utf-8").write(json.dumps(F, ensure_ascii=False, indent=1) + chr(10))
    if gone:
        print("말이 다 빠져 버린 자막 줄 %d: %s" % (len(gone), " / ".join(gone)))
print("자막 %d줄 -> %s (고친 줄 %d, 연출 참조 %d곳 따라 바꿈, 컷 따라 옮긴 연출 시각 %d)" % (len(caps), out, len(ren), n, moved))
if any(c.get("os2") is not None or c.get("oe2") is not None for c in caps):
    print("알림: 원본 시각 고침은 컷이라 이번 렌더에 안 들어갑니다 - '편집'(AI)으로 넘기세요")
