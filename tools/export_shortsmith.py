# -*- coding: utf-8 -*-
"""shortsmith 편 폴더 -> 대시보드 프로젝트 저장소 (projects/<id>/project.json · meta.json · thumb.jpg).

    python tools/export_shortsmith.py <편 폴더> [프로젝트id] [--keep-feedback]

옛 편마다 있던 export_project.py (500줄, timeline.py · build_ass 에 묶임) 를 shortsmith 편 공용으로 줄인 것.
읽는 것: edit.json · cuts.json · captions.csv · scene.json · word_level_large.json · notes.md (판단, "- " 줄마다 하나).
지키는 것 (메모리 export-to-user-editor): 프로젝트는 드랍한 대상 파일 이름으로 찾는다 · 이름 / 만든 날짜 / 로그 / 드랍 은
그대로 · 지난 피드백(프롬프트 · 쪽지 · 고친 자막)은 편 폴더에 갈무리하고 비운다 · 덮기 전에 project.json.bak · clip.crop 은 0~1 비율 · 소리 없음은 volume 0.
대시보드가 그 프로젝트를 열어 둔 채면 브라우저가 덮어쓴다 - 탭을 닫고 돌릴 것.
"""
import csv, datetime, io, json, os, shutil, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))     # E:\Edit\Claude
STORE = os.environ.get("KIRINUKI_PROJECTS") or os.path.join(ROOT, "projects")   # 시험용 저장소로 돌릴 때 (2026-10-02)
KEEP = "--keep-feedback" in sys.argv          # AI 없는 렌더 단추가 붙인다 (tools/apply_review.py 다음)
# 전사만 갈아 끼운다 (2026-09-29, 낱말 단위 재전사 뒤). 자막 · 쪽지 · 프롬프트 · 편집기는 그대로 둔다 -
# 대시보드에서 고친 자막(화자 · 시각)이 아직 captions.csv 에 안 들어갔을 수 있어서 통째로 다시 쓰면 사라진다
TR_ONLY = "--transcript-only" in sys.argv
sys.argv = [a for a in sys.argv if a != "--transcript-only"]
sys.argv = [a for a in sys.argv if not a.startswith("--")]
WORK = os.path.abspath(sys.argv[1])
os.chdir(WORK)
E = json.load(io.open("edit.json", encoding="utf-8"))
C = json.load(io.open("cuts.json", encoding="utf-8"))["pieces"]
S = json.load(io.open("scene.json", encoding="utf-8"))
SPEED = float(E.get("speed") or 1)
SRC = E["source"]
FINAL = E["out"] if os.path.isabs(E["out"]) else os.path.join(WORK, E["out"])
NAME = os.path.basename(WORK)
W, H = S["width"], S["height"]
WORD_LAG = float(E.get("wordLag", 0.3))   # 위스퍼 낱말이 소리보다 이른 정도 - 편마다 재서 edit.json 에 둔다 (없으면 0.3, 짐작)


def ts(t):
    h, m, s = t.split(":")
    return int(h) * 3600 + int(m) * 60 + float(s)


def dur_of(p):
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", p],
                       capture_output=True, text=True)
    try:
        return round(float(r.stdout), 3)
    except ValueError:
        return None


# 조각 -> 완성본 시각 (본편은 배속, 다른 파일 조각은 배속 없음)
flat, t = [], 0.0
for p in C:
    d = (p["e"] - p["s"]) / (1 if p.get("source") else SPEED)
    flat.append((p, t, d))
    t += d
TOTAL = round(t, 3)
main = [(p["s"], p["e"]) for p in C if not p.get("source") and not p.get("gap")]


def out_time(x):
    for p, o, d in flat:
        if not p.get("source") and not p.get("gap") and p["s"] <= x <= p["e"]:
            return o + (x - p["s"]) / SPEED
    return None


# 자막이 없는 편도 있다 (댄스 쇼츠 - 프리셋이 "요청할 때만 자막")
CAPF = E.get("captions", "captions.csv")
rows = list(csv.DictReader(io.open(CAPF, encoding="utf-8-sig"))) if os.path.exists(CAPF) else []
clock = E.get("captionClock", "output")
conv = (lambda x: x) if clock == "output" else (lambda x: x / SPEED) if clock == "timeline" else (lambda x: out_time(x) or 0)
title = next((r["text"].strip() for r in rows if r["speaker"].strip().lower() in ("제목", "title")), (S.get("title") or {}).get("text", ""))
NOT_DRAWN = ("제목", "title", "채팅", "후원", "설명", "주석")   # 자막으로 안 그리는 화자 (그림은 fx.json 이 그린다)
caps = [r for r in rows if r["speaker"].strip().lower() not in NOT_DRAWN]
kinds = S.get("kinds") or {}
style = S.get("style") or {}
sname = style.get("name") or E["preset"]
notes = [l[2:].strip() for l in io.open("notes.md", encoding="utf-8") if l.startswith("- ")] if os.path.exists("notes.md") else []

# --- 사용자 편집 타임라인 (피드백 탭은 scene.json 을 쓰고, 이건 손으로 고치는 탭용) ---
src_dur = dur_of(SRC)
assets = [{"id": "as_src", "kind": "video", "name": os.path.basename(SRC), "path": SRC, "size": None, "duration": src_dur, "rows": None}]
tracks = [{"id": i, "kind": k, "name": n, "role": r, "muted": False, "locked": False} for i, k, n, r in (
    ("trk_title", "caption", "상단 캡션", "title"), ("trk_cap", "caption", "자막", "caption"),
    ("trk_vid", "video", "영상", "source"), ("trk_bg", "video", "배경 (프리셋)", "background"), ("trk_aud", "audio", "오디오", "source"))]
win = S["window"]
band = {"x": win["x"], "y": win["y"], "w": win["w"], "h": win["h"]}
clips, extra = [], {}
for n, (p, o, d) in enumerate([f for f in flat if not f[0].get("gap")], 1):   # 빈 틈(리플 끔)은 클립이 아니다
    src = p.get("source") or SRC
    aid = "as_src"
    if p.get("source"):
        aid = extra.setdefault(src, "as_x%d" % len(extra))
        if not any(a["id"] == aid for a in assets):
            assets.append({"id": aid, "kind": "video", "name": os.path.basename(src), "path": src, "size": None, "duration": dur_of(src), "rows": None})
    cr = p.get("crop") or E.get("crop")
    crop = None
    if cr and src_dur and not p.get("source"):   # 0~1 비율 (메모리 export-to-user-editor)
        crop = {"x": round(cr["x"] / 1920, 4), "y": round(cr["y"] / 1080, 4), "w": round(cr["w"] / 1920, 4), "h": round(cr["h"] / 1080, 4)}
    name = "컷 %d · 원본 %.2f-%.2f초%s" % (n, p["s"], p["e"], " (%s)" % os.path.basename(src) if p.get("source") else "")
    for trk, kind in (("trk_vid", "video"), ("trk_aud", "audio")):
        clips.append({"id": "%s_%04d" % (kind, n), "trackId": trk, "kind": kind, "name": name, "assetId": aid, "groupId": "grp_%02d" % n,
                      "start": round(o, 3), "dur": round(d, 3), "offset": round(p["s"], 3), "srcDur": src_dur,
                      "frame": band if kind == "video" else None, "crop": crop if kind == "video" else None, "loop": False,
                      "volume": 1, "opacity": 1, "speaker": "", "text": "", "style": None})
bg = S.get("body", {}).get("bg")
if bg and os.path.exists(bg):
    bgp = os.path.abspath(bg).replace(os.sep, "/")
    assets.append({"id": "as_bg", "kind": "video", "name": "bg.mp4", "path": bgp, "size": None, "duration": dur_of(bgp), "rows": None})
    clips.append({"id": "video_bg", "trackId": "trk_bg", "kind": "video", "name": "프리셋 배경", "assetId": "as_bg", "groupId": None,
                  "start": 0.0, "dur": TOTAL, "offset": 0, "srcDur": None, "frame": {"x": 0, "y": 0, "w": W, "h": H}, "crop": None,
                  "loop": True, "volume": 0, "opacity": 1, "speaker": "", "text": "", "style": None})
base_style = {"font": '"CookieRunOTF Black", Pretendard, sans-serif', "size": 6.77, "posY": 74.8, "posX": 50, "color": "#ffffff",
              "outline": "#181a20", "outlineWidth": 3, "shadow": "#17fff8", "shadowOff": 7, "bg": "transparent", "bold": True,
              "italic": False, "align": "center", "showSpeaker": False, "emphasis": False}   # 대략값 - 정확한 모양은 피드백 탭(scene)이 그린다
clips.append({"id": "cap_title", "trackId": "trk_title", "kind": "caption", "name": title, "assetId": None, "groupId": None,
              "start": 0.0, "dur": TOTAL, "offset": 0, "srcDur": None, "frame": None, "crop": None, "loop": False, "volume": 1,
              "opacity": 1, "speaker": "", "text": title, "style": dict(base_style, font='"BM JUA_OTF", Pretendard, sans-serif', size=9.9, posY=15.5, outline="#4267bf", shadow="#27246e")})
for i, r in enumerate(caps, 1):
    s0, e0 = conv(ts(r["start"])), conv(ts(r["end"]))
    clips.append({"id": "cap_%04d" % i, "trackId": "trk_cap", "kind": "caption", "name": r["text"], "assetId": None, "groupId": None,
                  "start": round(s0, 3), "dur": round(e0 - s0, 3), "offset": 0, "srcDur": None, "frame": None, "crop": None, "loop": False,
                  "volume": 1, "opacity": 1, "speaker": r["speaker"].strip(), "text": r["text"].strip(), "style": base_style})

# --- 피드백 탭: 전사(낱말마다 남았는지) · 자막 · scene ---
segs = []
# 전사본 파일은 edit.json 의 "transcript" 로 고를 수 있다 (재전사한 편은 그쪽이 낫다)
TRF = E.get("transcript") or next((f for f in ("word_level_large.json",) if os.path.exists(f)), None)
if TRF and os.path.exists(TRF):
    for seg in json.load(io.open(TRF, encoding="utf-8")):
        ws = []
        for w in seg.get("words", []):
            a, b = float(w["start"]), float(w["end"])
            ca, cb = a + WORD_LAG, b + WORD_LAG
            ov = sum(max(0.0, min(cb, y) - max(ca, x)) for x, y in main)
            keep = ov >= (cb - ca) * 0.5 or any(x + 0.10 <= cb <= y for x, y in main)
            ot = (out_time(a) or out_time(ca)) if keep else None
            ws.append({"s": round(a, 3), "e": round(b, 3), "w": w["word"].strip(), "keep": keep, "restore": None, "drop": None,
                       "out": round(ot, 3) if ot is not None else None,
                       "ws": round(float((w.get("whisper") or [a])[0]), 3)})
        segs.append({"s": round(float(seg["start"]), 3), "e": round(float(seg["end"]), 3), "text": (seg.get("text") or "").strip(), "words": ws})
review = {"video": {"ko": FINAL.replace(os.sep, "/")} if os.path.exists(FINAL) else {}, "base": "ko", "canvas": [W, H],
          "kept": [[round(a, 3), round(b, 3)] for a, b in main], "restore": [], "drop": [], "transcript": segs,
          # 조각(클립)마다 원본 시각과 완성본 시각 - 피드백 탭의 타임스탬프 칸이 쓴다 (2026-09-28)
          "clips": [{"i": i + 1, "s": round(pc["s"], 3), "e": round(pc["e"], 3),
                     "os": round(o, 3), "oe": round(o + d, 3)} for i, (pc, o, d) in enumerate([f for f in flat if not f[0].get("gap")])],
          "captions": [{"s": round(conv(ts(r["start"])), 3), "e": round(conv(ts(r["end"])), 3), "speaker": r["speaker"].strip(),
                        "kind": (r.get("kind") or "").strip(), "text": r["text"].strip(), "by": "claude"} for r in rows],
          "scene": os.path.abspath("scene.json").replace(os.sep, "/"), "notes": [], "prompt": ""}
# 굽지 않은 판 (2026-10-02, 사용자: "마지막에 한 번만 렌더링하고 그 전까지는 미리보기에서만"): scene.json 이 완성본보다 새것이면
# (shortsmith preview / tools/preview_update.py 로 고친 판) 피드백 · 사용자 편집 미리보기가 완성본 대신 원본 사본에서 컷대로 이어 튼다
review["unbaked"] = not os.path.exists(FINAL) or os.path.getmtime(FINAL) < os.path.getmtime("scene.json") - 1
# 원본 소리 파형 - 피드백 탭 편집 축에 그린다 (2026-09-30, tools/src_wave.py, 원본이 그대로면 편 폴더 wave.json 을 다시 씀)
sys.path.insert(0, os.path.join(ROOT, "tools"))
from src_wave import wave_of
review["wave"] = wave_of(WORK, SRC if os.path.isabs(SRC) else os.path.join(WORK, SRC))


# --- 저장소에 써 넣기 ---
def find_project():
    if len(sys.argv) > 2:
        return os.path.join(STORE, sys.argv[2])
    want, fallback = os.path.basename(SRC), None
    for nm in sorted(os.listdir(STORE)):
        pj = os.path.join(STORE, nm, "project.json")
        if nm.startswith("_") or not os.path.isfile(pj):
            continue
        try:
            p = json.load(io.open(pj, encoding="utf-8"))
        except ValueError:
            continue
        if any((x.get("name") or "") == want for x in (((p.get("ai") or {}).get("drops") or {}).get("apply.target") or [])):
            return os.path.join(STORE, nm)
        if ((p.get("project") or {}).get("name") or "").replace(" ", "") == NAME.replace(" ", ""):
            fallback = os.path.join(STORE, nm)
    return fallback


pd = find_project()
if not pd or not os.path.isfile(os.path.join(pd, "project.json")):
    sys.exit("저장소에서 프로젝트를 못 찾음 - python tools/export_shortsmith.py <편 폴더> <프로젝트id>")
pj = os.path.join(pd, "project.json")
shutil.copyfile(pj, pj + ".bak")
cur = json.load(io.open(pj, encoding="utf-8"))
pid = os.path.basename(pd)
now = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
old = cur.get("review") or {}
if TR_ONLY:
    # 사용자가 누른 되살리기 · 빼기 표는 같은 낱말(글 + 위스퍼 시각 0.05초 안)에 옮겨 단다
    prev = [w for sg in (old.get("transcript") or []) for w in sg.get("words", []) if w.get("restore") or w.get("drop")]
    for sg in segs:
        for w in sg["words"]:
            m = next((x for x in prev if x["w"] == w["w"] and abs(x["s"] - w.get("ws", w["s"])) < 0.05), None)
            if m:
                w["restore"], w["drop"] = m.get("restore"), m.get("drop")
    old["transcript"] = segs
    cur["review"] = old
    io.open(pj, "w", encoding="utf-8").write(json.dumps(cur, ensure_ascii=False, indent=2) + chr(10))
    print("전사만 갈아 끼움: %s  (%s · 낱말 %d · 옮긴 표 %d)" % (pid, TRF, sum(len(x["words"]) for x in segs), len(prev)))
    sys.exit(0)
if not KEEP and (old.get("prompt") or "").strip() and not os.path.exists("feedback_prompt.txt"):
    io.open("feedback_prompt.txt", "w", encoding="utf-8").write(old["prompt"].strip() + "\n")
# 다시 편집했으면 지난 피드백(쪽지 · 고친 자막)은 반영이 끝난 것이다 - 비운다 (지시: 재편집 시 기존 피드백 제거).
# 비우기 전에 편 폴더에 갈무리해 둔다 (반영했는지 나중에 확인할 수 있게)
fb = {"notes": old.get("notes") or [], "captions": [c for c in (old.get("captions") or []) if c.get("by") == "user"]}
if KEEP:
    # AI 없는 "렌더" 뒤: 프롬프트 · 쪽지는 아직 "편집"(AI) 을 기다리는 것이라 그대로 둔다.
    # 고친 자막은 captions.csv 에 들어갔으니 표만 옮겨 단다 (같은 글 + 0.3초 안)
    review["prompt"], review["notes"] = old.get("prompt") or "", fb["notes"]
    for c in review["captions"]:
        u = next((x for x in fb["captions"] if x.get("text", "").strip() == c["text"] and abs(x["s"] - c["s"]) < 0.3), None)
        if u:
            c["by"], c["orig"] = "user", u.get("orig")
elif fb["notes"] or fb["captions"]:
    io.open("feedback_%s.json" % datetime.datetime.now().strftime("%m%d_%H%M"), "w", encoding="utf-8").write(json.dumps(fb, ensure_ascii=False, indent=1))
if old.get("ripple") is False:
    review["ripple"] = False        # 리플 켬/끔은 사용자가 고른 설정이다 - 다시 내보내도 지킨다 (2026-09-30)
cur.update({"version": 1, "layout": {"canvas": [W, H]}, "editNotes": notes, "savedAt": now, "review": review,
            "editor": {"assets": assets, "tracks": tracks, "clips": clips, "duration": TOTAL, "pxPerSec": 60, "playhead": 0, "sync": True, "snap": True}})
r = cur.setdefault("render", {}) or {}
cur["render"] = r
r["dir"] = (os.path.relpath(WORK, ROOT) if os.path.splitdrive(WORK)[0].lower() == os.path.splitdrive(ROOT)[0].lower() else WORK).replace(os.sep, "/")
r["out"] = FINAL.replace(os.sep, "/")
r["base"] = r.get("base") or "ko"
r["engine"] = "shortsmith"
log = cur.setdefault("log", [])
log.append({"t": datetime.datetime.now().strftime("%H:%M:%S"), "ts": int(datetime.datetime.now().timestamp() * 1000), "level": "INFO",
            "msg": "편집 반영: 컷 %d · 자막 %d · %.2f초" % (len(C), len(caps), TOTAL), "src": "apply", "pid": pid})
cur["log"] = log[-500:]
p = cur.setdefault("project", {})
p["id"] = pid
p["style"] = sname
meta = {"duration": TOTAL, "cuts": len([p for p in C if not p.get("gap")]), "captions": len(caps), "notes": len(notes), "source": os.path.basename(SRC),
        "assets": len(assets), "id": pid, "name": p.get("name") or NAME, "createdAt": p.get("createdAt") or now, "savedAt": now, "style": sname}
io.open(pj, "w", encoding="utf-8").write(json.dumps(cur, ensure_ascii=False, indent=2) + "\n")
io.open(os.path.join(pd, "meta.json"), "w", encoding="utf-8").write(json.dumps(meta, ensure_ascii=False, indent=2) + "\n")
if os.path.exists(FINAL):
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", "8", "-i", FINAL, "-frames:v", "1", "-vf", "scale=480:-1", "-q:v", "4",
                    os.path.join(pd, "thumb.jpg")])
print("저장소 반영: %s  (컷 %d · 자막 %d · %.2f초 · 판단 %d)" % (pid, len(C), len(caps), TOTAL, len(notes)))
# 굽지 않은 미리보기용 원본 사본 (되살리기 · 빼기를 렌더 없이 듣는다, 2026-09-29). 원본이 그대로면 다시 안 굽는다
subprocess.run([sys.executable, os.path.join(ROOT, "tools", "src_preview.py"), WORK, pid])
