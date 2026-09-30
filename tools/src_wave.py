# -*- coding: utf-8 -*-
"""원본 소리 파형 (피드백 탭 편집 축에 그린다, 2026-09-30).

사용자: "편집 클립 내부에 실제 파형 넣어줘 (세로, 위에서 아래 방향으로 진행, 타임라인 축을 기준으로 가운데 정렬, 축 좌우로 데칼코마니)".
원본 소리를 20ms 마다 최고값으로 재서 dB(-60..0) 를 0..255 한 바이트로 담는다 - 211초면 10.6KB (base64 14KB).
대시보드는 빼기 · 되살리기 계획대로 원본 시각을 편집 시각에 옮겨 그린다 (feedback.js drawWave).
소리 필터 없음 - 재는 데만 쓴다. 원본이 그대로면 편 폴더의 wave.json 을 다시 쓴다.

    python tools/src_wave.py <편 폴더>            (export_shortsmith.py 가 불러 review.wave 에 넣는다)
"""
import base64, io, json, os, subprocess, sys

HZ, FLOOR = 50, -60.0


def wave_of(work, src):
    st = os.stat(src)
    key = {"src": src, "size": st.st_size, "mtime": int(st.st_mtime), "hz": HZ, "v": 1}
    cache = os.path.join(work, "wave.json")
    if os.path.exists(cache):
        old = json.load(io.open(cache, encoding="utf-8"))
        if old.get("key") == key:
            return old["wave"]
    import numpy as np
    sr = 8000
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", src, "-vn", "-ac", "1", "-ar", str(sr), "-f", "s16le", "-"],
                         capture_output=True, check=True).stdout
    x = np.abs(np.frombuffer(raw, np.int16).astype(np.float32) / 32768.0)
    n = sr // HZ
    m = len(x) // n
    peak = x[:m * n].reshape(m, n).max(1)
    db = 20 * np.log10(peak + 1e-9)
    b = np.clip((db - FLOOR) / -FLOOR * 255, 0, 255).astype(np.uint8)
    wave = {"hz": HZ, "floor": FLOOR, "b64": base64.b64encode(b.tobytes()).decode("ascii")}
    json.dump({"key": key, "wave": wave}, io.open(cache, "w", encoding="utf-8"))
    return wave


if __name__ == "__main__":
    work = os.path.abspath(sys.argv[1])
    E = json.load(io.open(os.path.join(work, "edit.json"), encoding="utf-8"))
    src = E["source"] if os.path.isabs(E["source"]) else os.path.join(work, E["source"])
    w = wave_of(work, src)
    print("파형 %d칸 (%.1f초) -> %s" % (len(base64.b64decode(w["b64"])), len(base64.b64decode(w["b64"])) / HZ, os.path.join(work, "wave.json")))
