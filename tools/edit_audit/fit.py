# -*- coding: utf-8 -*-
"""자막 줄이 글자 크기를 줄이지 않고 들어가는지 · 한 문장을 둘로 나눈 줄이 한쪽으로 치우쳤는지 (2026-09-30).

사용자: "한 자막 내에 너무 많은 글자가 들어가 있는 경우가 있는데 -> 폰트가 작아지잖아 안 작아질 정도로만 적어줘.
의미 단위로 나누되 앞부분이 길어서 둘로 나뉘는 경우 8:2 이렇게 나누지 말고 가능하면 앞 뒤 클립이 비슷한 글자가 되게 - 모든 프리셋에 해당"

렌더러(shortsmith/src/parts/Caption.tsx)는 한 줄 폭이 layout.maxTextWidth 를 넘으면 글자 크기를 그 비율만큼 줄인다.
같은 식으로 잰다: 폭 = 글꼴 파일로 잰 글 폭 (크기 size * lineToEm, «낱말|색» 표시는 벗김, 디자인의 wrap 괄호 포함).
글꼴 · 크기 · 폭은 편의 프리셋에서 읽는다 (shortsmith lib/preset.mjs 로 찾음) - 프리셋마다 다르다.

    python tools/edit_audit/fit.py <편 폴더>                 captions.csv 검사
    python tools/edit_audit/fit.py <편 폴더> "글" ["디자인"]   한 줄만 재기 (쓰기 전에)

폭은 PIL(FreeType) 로 잰다 - 브라우저 canvas 와 1-2% 다를 수 있다 (짐작, 커닝 처리 차이). 그래서 97% 를 넘으면 경고한다.
치우침: 같은 화자 줄이 쉼 없이 이어지고(앞 끝 = 뒤 시작) 둘을 합친 글자 수에서 한쪽이 70% 를 넘으면 알린다.
한 문장을 나눈 것인지는 이 스크립트가 모른다 - 알린 것 가운데 한 문장인 것만 고친다.
"""
import csv, io, json, os, re, subprocess, sys
from PIL import ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
work = os.path.abspath(sys.argv[1])
E = json.load(io.open(os.path.join(work, "edit.json"), encoding="utf-8"))
js = ("import {loadPreset} from 'file:///%s/shortsmith/lib/preset.mjs';"
      "const r=loadPreset(process.argv[1], process.argv[2]);"
      "process.stdout.write(JSON.stringify({fonts:r.preset.fonts,captions:r.preset.captions,layout:r.preset.layout}))") % ROOT.replace(os.sep, "/")
out = subprocess.run(["node", "--input-type=module", "-e", js, E["preset"], work], capture_output=True, text=True, encoding="utf-8")
if out.returncode:
    sys.exit(out.stderr)
P = json.loads(out.stdout)
C, MAXW = P["captions"], P["layout"]["maxTextWidth"]
names = C.get("kindNames") or {}
plain = lambda t: re.sub(r"«(.+?)\|[A-Za-z#0-9]+»", r"\1", t)
_font = {}


def kind_of(name):
    k = names.get(name) or (name if name in C["kinds"] else C.get("defaultKind"))
    return k, C["kinds"].get(k) or C["kinds"][C["defaultKind"]]


def width(text, kname):
    k, K = kind_of(kname)
    if K.get("lines"):
        return None, k                     # 상자 안에서 줄을 바꾸는 디자인 - 줄이지 않고 접는다
    F = P["fonts"][K["font"]]
    if not F.get("path"):
        return None, k
    if F["path"] not in _font:
        m = ImageFont.truetype(F["path"], 100)
        a, d = m.getmetrics()
        _font[F["path"]] = F.get("lineToEm") or 100.0 / (a + d)
    css = K["size"] * _font[F["path"]]
    f = ImageFont.truetype(F["path"], max(1, int(round(css))))
    raw = plain(text)
    if K.get("wrap"):
        raw = K["wrap"][0] + raw + K["wrap"][1]
    return f.getlength(raw) * css / max(1, round(css)), k


if len(sys.argv) > 2:                      # 한 줄만
    w, k = width(sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else "")
    print("%s  %s  폭 %.0f / %d  (%.0f%%)%s" % (sys.argv[2], k, w or 0, MAXW, 100 * (w or 0) / MAXW,
                                               "  <== 글자가 작아진다" if w and w > MAXW * 0.97 else ""))
    sys.exit(0)

ts = lambda s: sum(float(x) * m for x, m in zip(s.split(":")[::-1], (1, 60, 3600)))
rows = list(csv.DictReader(io.open(os.path.join(work, E.get("captions", "captions.csv")), encoding="utf-8-sig")))
SKIP = ("제목", "title", "채팅", "후원", "설명", "주석")
lines = [(ts(r["start"]), ts(r["end"]), r["speaker"].strip(), (r.get("kind") or "").strip(), r["text"].strip()) for r in rows
         if r["speaker"].strip() not in SKIP and r["text"].strip()]
big = []
for s, e, spk, kn, t in lines:
    w, k = width(t, kn)
    if w and w > MAXW * 0.97:
        big.append((s, t, k, w))
lean = []
for (s0, e0, sp0, _, t0), (s1, e1, sp1, _, t1) in zip(lines, lines[1:]):
    if sp0 != sp1 or abs(s1 - e0) > 0.05:
        continue
    a, b = len(plain(t0).replace(" ", "")), len(plain(t1).replace(" ", ""))
    if max(a, b) > 0.7 * (a + b):
        lean.append((s0, t0, t1, a, b))

print("프리셋 %s · 줄 폭 %dpx · 자막 %d줄" % (E["preset"], MAXW, len(lines)))
print("\n[글자가 작아지는 줄] %d" % len(big))
for s, t, k, w in big:
    print("  %6.2f  %-5s %3.0f%%  %s" % (s, k, 100 * w / MAXW, t))
print("\n[쉼 없이 이어진 두 줄이 한쪽으로 치우침 (70%% 넘음)] %d - 한 문장을 나눈 것만 고친다" % len(lean))
for s, t0, t1, a, b in lean:
    print("  %6.2f  %d:%d  %s / %s" % (s, a, b, t0, t1))
