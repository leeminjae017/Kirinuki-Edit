# -*- coding: utf-8 -*-
"""편 폴더 -> 카덴라이브 프로젝트 (2026-10-02 첫 판). 손으로 마무리할 수 있게 넘긴다.

사용자: "다빈치 리졸브 무료판에서 ... 직접적인 컷 편집, 자막 편집등의 수정은 원하는 대로 안돼 -> 다른 프로그램을 써야 해",
"이미 전부 구현된 소스 코드는 없어? ... 안되면 카덴라이브로 해줘". 카덴라이브는 프로젝트가 글 파일 (MLT XML) 이라 우리가 쓰고,
사용자가 고친 것을 다시 읽을 수 있다.

    python tools/export_kdenlive.py <편 폴더>        -> <편>/kdenlive/<편 이름>.kdenlive (+ .kdenlive.ass 자막)

먼저 shortsmith build 가 끝나 있어야 한다 (scene.json · body.json · cuts.json · bg.mp4 를 읽는다).

타임라인 (아래부터):
  소리 1   원본 소리 - 조각마다 이득 (cuts.json gainDb), 전체 이득은 완성본과 같은 식 (min(-16 - I, -1.5 - TP), 고정 이득 한 번)
  화면 1   프리셋 배경 (bg.mp4, 이 편 길이로 구운 것)
  화면 2   원본 조각 - 원본을 가리키는 클립이라 끝을 끌어 늘이고 줄일 수 있다. 자르기 (edit.crop / 조각 crop) + 창 자리로 옮기기
  자막     카덴라이브 자막 (글을 바로 고칠 수 있다) - 종류마다 ASS 스타일 (프리셋 값: 글꼴 · 크기 · 채움 · 테두리 · 그림자)
소리 1 과 화면 2 의 같은 조각은 묶여 있다 (같이 움직이고 같이 늘어난다).

첫 판에서 빠진 것 (확인하고 넣는다): 제목 · 그림 · 채팅 · 말풍선 · 장면 오려 넣기 · 화면 효과 (확대 · 흔들기 · 흑백),
컷 자리 소리 겹침 (crossfadeSec), 댄스 카메라 움직임, 강조 (이중 테두리) · 발끈 (그라데이션) 의 정확한 모양 - 비슷한 색 한 겹으로 근사.
"""
import io, json, math, os, re, subprocess, sys, time, uuid
from xml.sax.saxutils import escape, quoteattr
from PIL import ImageFont

work = os.path.abspath(sys.argv[1])
name = os.path.basename(work.rstrip("\\/"))
J = lambda f: json.load(io.open(os.path.join(work, f), encoding="utf-8"))
E, S, B, C = J("edit.json"), J("scene.json"), J("body.json"), J("cuts.json")
st = S["style"]
FPS, CW, CH = S["fps"], S["width"], S["height"]
src = (E["source"] if os.path.isabs(E["source"]) else os.path.join(work, E["source"])).replace("\\", "/")
if (E.get("speed") or 1) != 1:
    sys.exit("edit.speed 가 1 이 아닌 편은 아직 못 옮긴다")
outdir = os.path.join(work, "kdenlive")
os.makedirs(outdir, exist_ok=True)
proj = os.path.join(outdir, name + ".kdenlive")
assf = proj + ".ass"                                # 카덴라이브가 찾는 자리: <프로젝트 파일 이름>.ass (kdenlivedoc.cpp subTitlePath)


def probe(path):
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type,width,height:format=duration", "-of", "json", path],
                       capture_output=True, text=True, encoding="utf-8")
    j = json.loads(r.stdout)
    v = next((s for s in j["streams"] if s["codec_type"] == "video"), {})
    return v.get("width"), v.get("height"), float(j["format"]["duration"])


SW, SH, SDUR = probe(src)
bg = os.path.join(work, S["body"]["bg"]).replace("\\", "/")
_, _, BDUR = probe(bg)
win = S["window"]
WX, WY, WW, WH = win["x"], win["y"], win["w"], win.get("h") or B["windowH"]

# ---- 조각 -> 타임라인 프레임. 자리 · 길이는 body.json (굽기와 같은 값), 원본 시각은 cuts.json ----
pieces, pos = [], 0
for p, (_, t0, d) in zip(C["pieces"], B["pieces"]):
    n = int(round((t0 + d) * FPS)) - int(round(t0 * FPS))   # 자리는 굽기 시각의 프레임, 조각마다 반올림하면 끝이 2프레임 모자랐다
    if p.get("gap"):
        pieces.append(dict(gap=True, pos=pos, n=n))
    elif p.get("source"):
        sys.exit("다른 파일 조각 (아웃트로) 은 아직 못 옮긴다")
    else:
        crop = p.get("crop") or E.get("crop") or {"x": 0, "y": 0, "w": SW, "h": SH}
        pieces.append(dict(pos=pos, n=n, inf=int(round(p["s"] * FPS)), gain=p.get("gainDb") or 0, crop=crop))
    pos += n
TOTAL = pos


# ---- 전체 소리 이득: 완성본과 같은 식 (조각 이득이 들어간 window.mkv 를 잰다) ----
def loud(path):
    r = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", path, "-map", "0:a", "-af", "ebur128=peak=true", "-f", "null", "-"],
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    tail = r.stderr[r.stderr.rfind("Summary:"):]
    return float(re.search(r"I:\s*(-?[\d.]+) LUFS", tail).group(1)), float(re.search(r"Peak:\s*(-?[\d.]+) dBFS", tail).group(1))


I, TP = loud(os.path.join(work, S["body"]["window"]))
A = st.get("audio") or {}
MASTER = round(min(A.get("targetLufs", -16) - I, A.get("maxTruePeakDb", -1.5) - TP), 2)

# ---- 자막 (ASS) ----
K = st["captions"]["kinds"]
fonts = st["fonts"]
capY, MAXW = st["layout"]["captionY"], st["layout"]["maxTextWidth"]
marks = st["captions"].get("markColors") or {}


def rgba(c, alpha=1.0):
    m = re.match(r"rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)", c or "")
    if m:
        return int(m[1]), int(m[2]), int(m[3]), float(m[4]) if m[4] else alpha
    c = (c or "#FFFFFF").lstrip("#")
    return int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16), alpha


def ass_col(c, alpha=1.0):
    """스타일 색 &HAABBGGRR (ASS 투명도는 거꾸로: 00 = 불투명)"""
    r, g, b, a = rgba(c, alpha)
    return "&H%02X%02X%02X%02X" % (int(round(255 * (1 - a))), b, g, r)


def tag_col(c):
    """글 안 색 태그 &HBBGGRR&"""
    r, g, b, _ = rgba(c)
    return "&H%02X%02X%02X&" % (b, g, r)


def look(k):
    """종류 -> (채움, 테두리 색, 테두리 두께, 그림자 색, 그림자 거리, 상자). 이중 테두리 · 그라데이션은 한 겹으로 근사"""
    if k.get("accentColor"):                       # 강조: 채움 + 안 테두리 (하양) + 어두운 바깥 테두리 -> 안 테두리만
        a = st["captions"].get("accent") or {}
        return k["accentColor"], "#FFFFFF", (a.get("inner") or {}).get("width", 7), None, 0, None
    if k.get("look"):                              # 발끈: 그라데이션 아래 색 + 짙은 테두리 + 짙은 그림자
        lk = k["look"]
        top = lk[-1].get("fill")
        fill = top["stops"][-1][1] if isinstance(top, dict) else top or "#FFFFFF"
        edge = next((x["stroke"] for x in lk if x.get("stroke") and not x.get("fill")), {"width": 3, "color": "#101010"})
        sh = next((x for x in lk if x.get("dx") and isinstance(x.get("fill"), str) and x.get("z") == 1), None)
        return fill, edge["color"], edge["width"], sh["fill"] if sh else None, sh["dx"] if sh else 0, None
    o, sh = k.get("outline") or {}, k.get("shadow") or {}
    return k.get("fill", "#FFFFFF"), o.get("color", "#000000"), o.get("width", 0), sh.get("color"), sh.get("offset", 0), k.get("box")


def text_width(t, k, size):
    F = fonts[k["font"]]
    if not F.get("path"):
        return 0
    css = size * (F.get("lineToEm") or 0.75)
    f = ImageFont.truetype(F["path"], max(1, int(round(css))))
    return f.getlength(t) * css / max(1, round(css))


def sec(t):
    t = max(0, t)
    h, m = int(t // 3600), int(t % 3600 // 60)
    return "%d:%02d:%05.2f" % (h, m, t - h * 3600 - m * 60)


styles, events = {}, []
hide = S.get("hideCaptions") or []
for c in S["captions"]:
    kname = c.get("kind") or st["captions"]["defaultKind"]
    k = K.get(kname) or K[st["captions"]["defaultKind"]]
    if any(a <= c["s"] < b for a, b in hide):
        continue
    size = k["size"]
    y = c.get("y", k.get("y", capY))
    x = c.get("x", k.get("x", CW / 2))
    raw = c["text"]
    if k.get("wrap"):
        raw = k["wrap"][0] + raw + k["wrap"][1]
    lines = re.sub(r"«(.+?)\|[^»]+»", r"\1", raw).split("\n")
    nl = len(lines)
    if not k.get("lines"):                         # 한 줄 폭이 넘으면 글자를 줄인다 (렌더러와 같은 잣대)
        w0 = max(text_width(l, k, size) for l in lines)
        if w0 > MAXW:
            size = int(size * MAXW / w0)
    else:                                          # 상자 안에서 접는 디자인 (설명): 폭 안에서 줄을 바꾼다 - 줄 수는 재서 셈
        lw = k["lines"].get("maxWidth", MAXW)
        nl = sum(max(1, -(-int(text_width(l, k, size)) // lw)) for l in lines)
    fill, edge, ew, shc, sho, box = look(k)
    sname = "%s_%d_%d" % (kname, round(x), round(y))  # 자리가 다르면 스타일을 나눠 글에 위치 태그를 안 넣는다 (고치기 쉽게)
    if sname not in styles:
        bstyle = 3 if box else 1
        if box:
            edge, ew, shc, sho = box["color"], box.get("pad", 12), box["color"], 0
        # 렌더러는 글 덩이 가운데를 (x, y) 에 둔다. 가운데 맞춤 (an5) 은 MarginV 를 안 써서 아래 맞춤 (an2) 으로 두고 아래 끝을 맞춘다
        mv = int(round(CH - y - k["size"] * nl / 2))
        ml, mr = int(round(max(0, 2 * x - CW))), int(round(max(0, CW - 2 * x)))
        if k.get("lines"):                         # 접는 폭: 가운데에서 maxWidth
            lw = k["lines"].get("maxWidth", MAXW)
            ml, mr = int(round(x - lw / 2)), int(round(CW - x - lw / 2))
        styles[sname] = ("Style: %s,%s,%d,%s,%s,%s,%s,0,0,0,0,100,100,0,0,%d,%g,%g,2,%d,%d,%d,1"
                         % (sname, fonts[k["font"]]["family"], k["size"], ass_col(fill), ass_col(fill), ass_col(edge),
                            ass_col(shc or "#000000", 1.0 if shc else 0.0), bstyle, ew, sho, ml, mr, mv))
    text = r"\N".join(re.sub(r"«(.+?)\|([^»]+)»", lambda m: r"{\c%s}%s{\c}" % (tag_col(marks.get(m[2], m[2])), m[1]), l)
                      for l in raw.split("\n"))
    if size != k["size"]:
        text = r"{\fs%d}" % size + text
    events.append("Dialogue: 0,%s,%s,%s,,0,0,0,,%s" % (sec(c["s"]), sec(c["e"]), sname, text))

with io.open(assf, "w", encoding="utf-8-sig", newline="\n") as f:
    f.write("[Script Info]\nScriptType: v4.00+\nPlayResX: %d\nPlayResY: %d\nWrapStyle: 0\nScaledBorderAndShadow: yes\nYCbCr Matrix: None\n\n" % (CW, CH))
    f.write("[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, "
            "StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n")
    f.write("\n".join(styles.values()) + "\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n")
    f.write("\n".join(events) + "\n")

# ---- MLT XML (카덴라이브 26.08 이 쓰는 모양 - 저장소 tests/dataset/test-keyframes.kdenlive 를 본보기로) ----
X = []
P = lambda k, v: '  <property name=%s>%s</property>' % (quoteattr(k), escape(str(v)))
fid = [0]


def flt(service, props, kid=True):
    """kid=False: 카덴라이브 안쪽 필터 (자막) - 효과 이름을 붙이면 사용자 효과로 읽는다"""
    fid[0] += 1
    return ('   <filter id="f%d">' % fid[0] + "".join("\n " + P(k, v) for k, v in [("mlt_service", service)] + ([("kdenlive_id", service)] if kid else []) + props)
            + "\n   </filter>")


def chain(cid, path, kid, mode, length):
    X.append(' <chain id="%s" out="%d">' % (cid, length - 1))
    X.extend([P("length", length), P("eof", "pause"), P("resource", path), P("mlt_service", "avformat-novalidate"), P("seekable", 1),
              P("kdenlive:clipname", ""), P("kdenlive:clip_type", 0), P("kdenlive:folderid", -1), P("kdenlive:id", kid), P("mute_on_pause", 0)])
    if mode == "video":
        X.extend([P("set.test_audio", 1), P("set.test_image", 0)])
    elif mode == "audio":
        X.extend([P("set.test_audio", 0), P("set.test_image", 1)])
    X.append(" </chain>")


def track(tid, plid, entries, audio):
    at = P("kdenlive:audio_track", 1) if audio else ""
    X.append(' <playlist id="%s">' % plid); X.append(at); X.extend(entries); X.append(" </playlist>")
    X.append(' <playlist id="%s_b">%s</playlist>' % (plid, at))
    X.append(' <tractor id="%s" in="0" out="%d">' % (tid, TOTAL - 1)); X.append(at)
    X.extend([P("kdenlive:trackheight", 67), P("kdenlive:timeline_active", 1), P("kdenlive:collapsed", 0),
              P("kdenlive:thumbs_format", ""), P("kdenlive:audio_rec", "")])
    hide_ = "video" if audio else "audio"
    X.extend(['  <track hide="%s" producer="%s"/>' % (hide_, plid), '  <track hide="%s" producer="%s_b"/>' % (hide_, plid), " </tractor>"])


SRC_LEN, BG_LEN = int(SDUR * FPS), int(BDUR * FPS)
# 카덴라이브 프로필 이름 (share/mlt/profiles). 이름이 없으면 카덴라이브가 기본 프로필 (720x576 25fps) 로 구웠다 - 1916 프레임이 76.6초로
PROFILE = {(1080, 1920): "vertical_hd_%d" % FPS, (1920, 1080): "atsc_1080p_%d" % FPS}.get((CW, CH), "")
g = math.gcd(CW, CH)
X.append('<?xml version="1.0" encoding="utf-8"?>')
X.append('<mlt LC_NUMERIC="C" producer="main_bin" version="7.41.0" root=%s>' % quoteattr(outdir.replace("\\", "/")))
X.append(' <profile description="%dx%d %dfps" width="%d" height="%d" progressive="1" sample_aspect_num="1" sample_aspect_den="1" '
         'display_aspect_num="%d" display_aspect_den="%d" frame_rate_num="%d" frame_rate_den="1" colorspace="709"/>'
         % (CW, CH, FPS, CW, CH, CW // g, CH // g, FPS))
chain("src_bin", src, 2, None, SRC_LEN)
chain("bg_bin", bg, 3, None, BG_LEN)
X.append(' <producer id="black_track" in="0" out="%d">' % (TOTAL - 1))
X.extend([P("length", 2147483647), P("eof", "continue"), P("resource", "black"), P("aspect_ratio", 1), P("mlt_service", "color"),
          P("kdenlive:playlistid", "black_track"), P("mlt_image_format", "rgba"), P("set.test_audio", 0), " </producer>"])
chain("src_a", src, 2, "audio", SRC_LEN)
chain("src_v", src, 2, "video", SRC_LEN)
chain("bg_v", bg, 3, "video", BG_LEN)

ea, ev, at = [], [], 0
for p in pieces:
    if p.get("gap"):
        continue
    if p["pos"] > at:
        ea.append('  <blank length="%d"/>' % (p["pos"] - at)); ev.append('  <blank length="%d"/>' % (p["pos"] - at))
    i0, i1 = p["inf"], p["inf"] + p["n"] - 1
    vol = ("\n" + flt("volume", [("level", p["gain"])])) if p["gain"] else ""
    ea.append('  <entry producer="src_a" in="%d" out="%d">\n %s%s\n  </entry>' % (i0, i1, P("kdenlive:id", 2), vol))
    cr = p["crop"]
    # 카덴라이브는 자르기 효과에 use_profile=1 (프로젝트 크기 기준 값) 을 기본으로 채운다 - 원본 px 로 적으니 카덴라이브에서만 창 안이 크게 확대됐다
    # (melt 는 원본 px 로 읽어 맞았다). 둘 다 같게 읽도록 프로젝트 크기로 바꿔 적고 use_profile=1 을 박는다
    kx, ky = CW / SW, CH / SH
    cropf = flt("crop", [("left", round(cr["x"] * kx, 3)), ("right", round((SW - cr["x"] - cr["w"]) * kx, 3)), ("top", round(cr["y"] * ky, 3)),
                         ("bottom", round((SH - cr["y"] - cr["h"]) * ky, 3)), ("center", 0), ("use_profile", 1)])
    tf = flt("qtblend", [("rect", "%d %d %d %d 1" % (WX, WY, WW, WH)), ("rotation", 0), ("compositing", 0), ("distort", 1)])
    ev.append('  <entry producer="src_v" in="%d" out="%d">\n %s\n%s\n%s\n  </entry>' % (i0, i1, P("kdenlive:id", 2), cropf, tf))
    at = p["pos"] + p["n"]
track("t_a1", "pl_a1", ea, True)
track("t_v1", "pl_v1", ['  <entry producer="bg_v" in="0" out="%d">\n %s\n  </entry>' % (min(BG_LEN, TOTAL) - 1, P("kdenlive:id", 3))], False)
track("t_v2", "pl_v2", ev, False)

SEQ = "{%s}" % uuid.uuid4()
groups = [{"children": [{"data": "0:%d" % p["pos"], "leaf": "clip", "type": "Leaf"}, {"data": "2:%d" % p["pos"], "leaf": "clip", "type": "Leaf"}],
           "type": "AVSplit"} for p in pieces if not p.get("gap")]
# 카덴라이브 25 이 저장한 프로젝트를 따른다 (자막이 든 것): 시퀀스 tractor 의 id 가 uuid 자체, 자막 파일은 프로젝트 옆 상대 이름,
# av.alpha · globalSubtitleStyles · hidesubtitle. id="seq" 로 두니 자막이 있을 때만 카덴라이브가 열다 죽었다 (자막 빼면 렌더 됨)
subs = [{"file": os.path.basename(assf), "id": 0, "name": "Subtitles"}]
ff = "%02d:%02d:%02d:%02d" % (TOTAL // FPS // 3600, TOTAL // FPS % 3600 // 60, TOTAL // FPS % 60, TOTAL % FPS)
X.append(' <tractor id="%s" in="0" out="%d">' % (SEQ, TOTAL - 1))
X.extend([P("kdenlive:duration", ff), P("kdenlive:maxduration", TOTAL), P("kdenlive:clipname", name), P("kdenlive:description", ""),
          P("kdenlive:uuid", SEQ), P("kdenlive:producer_type", 17), P("kdenlive:control_uuid", "{%s}" % uuid.uuid4()), P("kdenlive:id", 4), P("kdenlive:clip_type", 0), P("kdenlive:folderid", 2),
          P("kdenlive:sequenceproperties.activeTrack", 2), P("kdenlive:sequenceproperties.audioChannels", 2),
          P("kdenlive:sequenceproperties.audioTarget", 0), P("kdenlive:sequenceproperties.videoTarget", 2),
          P("kdenlive:sequenceproperties.disablepreview", 0), P("kdenlive:sequenceproperties.documentuuid", SEQ),
          P("kdenlive:sequenceproperties.globalSubtitleStyles", "[\n]\n"), P("kdenlive:sequenceproperties.hasAudio", 1), P("kdenlive:sequenceproperties.hidesubtitle", 0), P("kdenlive:sequenceproperties.hasVideo", 1), P("kdenlive:sequenceproperties.position", 0),
          P("kdenlive:sequenceproperties.scrollPos", 0), P("kdenlive:sequenceproperties.tracks", 3), P("kdenlive:sequenceproperties.tracksCount", 3),
          P("kdenlive:sequenceproperties.verticalzoom", 1), P("kdenlive:sequenceproperties.zonein", 0),
          P("kdenlive:sequenceproperties.zoneout", TOTAL), P("kdenlive:sequenceproperties.zoom", 8),
          P("kdenlive:sequenceproperties.groups", json.dumps(groups, indent=4)), P("kdenlive:sequenceproperties.guides", "[\n]\n"),
          P("kdenlive:sequenceproperties.subtitlesList", json.dumps(subs, ensure_ascii=False, indent=4))])
X.extend(['  <track producer="black_track"/>', '  <track producer="t_a1"/>', '  <track producer="t_v1"/>', '  <track producer="t_v2"/>'])
for i, (svc, b) in enumerate([("mix", 1), ("qtblend", 2), ("qtblend", 3)]):
    props = [("a_track", 0), ("b_track", b), ("mlt_service", svc), ("internal_added", 237), ("always_active", 1)]
    props += [("kdenlive_id", "mix"), ("accepts_blanks", 1), ("sum", 1)] if svc == "mix" else [("compositing", 0), ("distort", 0), ("rotate_center", 0)]
    X.append('  <transition id="tr%d">' % i + "".join("\n " + P(k, v) for k, v in props) + "\n  </transition>")
X.append(flt("volume", [("level", MASTER)]))                                 # 전체 이득 (고정 한 번 - 소리 다듬기 필터 아님)
X.append(flt("avfilter.subtitles", [("av.alpha", 1), ("internal_added", 237), ("av.filename", os.path.basename(assf))], kid=False))
X.append(" </tractor>")
X.append(' <playlist id="main_bin">')
X.extend([P("kdenlive:folder.-1.2", "Sequences"), P("kdenlive:docproperties.activetimeline", SEQ), P("kdenlive:docproperties.audioChannels", 2),
          P("kdenlive:docproperties.compositing", 1), P("kdenlive:docproperties.documentid", int(time.time() * 1000)),
          P("kdenlive:docproperties.enableproxy", 0), P("kdenlive:docproperties.generateproxy", 0),
          P("kdenlive:docproperties.kdenliveversion", "26.08.1"), P("kdenlive:docproperties.profile", PROFILE), P("kdenlive:docproperties.opensequences", SEQ),
          P("kdenlive:docproperties.seekOffset", 30000), P("kdenlive:docproperties.uuid", SEQ), P("kdenlive:docproperties.version", "1.1"),
          P("kdenlive:expandedFolders", ""), P("kdenlive:documentnotes", ""), P("xml_retain", 1)])
X.extend(['  <entry producer="src_bin" in="0" out="%d"/>' % (SRC_LEN - 1), '  <entry producer="bg_bin" in="0" out="%d"/>' % (BG_LEN - 1),
          '  <entry producer="%s" in="0" out="%d"/>' % (SEQ, TOTAL - 1), " </playlist>"])
X.extend([' <tractor id="project" in="0" out="%d">' % (TOTAL - 1), P("kdenlive:projectTractor", 1),
          '  <track producer="%s" in="0" out="%d"/>' % (SEQ, TOTAL - 1), " </tractor>", "</mlt>"])
io.open(proj, "w", encoding="utf-8", newline="\n").write("\n".join(x for x in X if x != "") + "\n")
print("카덴라이브 프로젝트: %s" % proj)
print("  조각 %d · 길이 %d 프레임 (%.2f초, %dfps) · 자막 %d줄 (스타일 %d) · 전체 이득 %+.2f dB" % (
    sum(1 for p in pieces if not p.get("gap")), TOTAL, TOTAL / FPS, FPS, len(events), len(styles), MASTER))
