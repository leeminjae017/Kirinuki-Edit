# -*- coding: utf-8 -*-
"""소스 전체의 말/쉼 지도 (재편집 2 2026-09-27).

앞 판들은 대역 트랙(700-3000Hz)에 -45/-62 문턱으로 토막을 잡았는데, 여린 음절이 그 아래로 내려가
말 한가운데를 쉼으로 읽었다 -> "반팔이랑" 이 컷에 반 잘렸다 (사용자: "반팔이 안들려").
그래서 **전대역**으로, 문턱을 훨씬 낮춰(-52 시작 / -60 확장) 다시 그린다. 컷은 이 지도의 쉼에서만 낸다.
"""
import json, numpy as np, wave

def env(path):
    w = wave.open(path); sr = w.getframerate()
    x = np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(float) / 32768
    H = int(0.02 * sr); n = len(x) // H
    return 20 * np.log10(np.sqrt((x[:n*H] ** 2).reshape(n, H).mean(1)) + 1e-9)

F, L = env('src_audio.wav'), env('src_level.wav')
N = min(len(F), len(L)); H = 0.02
STRONG, WEAK, GAP, MINLEN = -52, -60, 0.30, 0.10
M = np.maximum(F[:N], L[:N] - 6)        # 두 트랙 중 큰 쪽 (대역 트랙은 +12dB 이득이라 6 깎아 견준다)

on = M > WEAK
runs = []
i = 0
while i < N:
    if on[i]:
        j = i
        while j + 1 < N and on[j + 1]: j += 1
        if M[i:j+1].max() > STRONG: runs.append([i * H, (j + 1) * H])
        i = j + 1
    else: i += 1
out = []
for a, b in runs:                        # GAP 보다 짧게 떨어져 있으면 한 덩이
    if out and a - out[-1][1] < GAP: out[-1][1] = b
    else: out.append([a, b])
out = [(round(a, 2), round(b, 2)) for a, b in out if b - a >= MINLEN]

W = [(x['start'], x['end'], x['word'].strip())
     for s in json.load(open('word_level_large.json', encoding='utf-8')) for x in s['words']]
if __name__ == '__main__':
    json.dump(out, open('speech_map.json', 'w'), ensure_ascii=False)
    prev = 0.0
    for a, b in out:
        ws = ' '.join(c for s, e, c in W if a - 0.35 <= s < b)
        print('%5.2f-%5.2f (%.2f) 쉼 %4.2f  %s' % (a, b, b - a, a - prev, ws))
        prev = b
