# -*- coding: utf-8 -*-
"""완성본에 말 덩이가 통째로 들어갔는지 (재편집 2 2026-09-27).

사용자: "자막은 있는데 말소리는 스킵되는 현상" · "반팔이 안들려". 컷이 말 덩이 안을 지나가면 이렇게 된다.
소스 말 지도(speech_map.json)를 남긴 구간으로 옮겨 기대 덩이를 만들고, 완성본에서 잰 덩이와 견준다.
"""
import json, numpy as np, wave

def env(path, hop=0.02):
    w = wave.open(path); sr = w.getframerate()
    x = np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(float) / 32768
    H = int(hop * sr); n = len(x) // H
    return 20 * np.log10(np.sqrt((x[:n*H] ** 2).reshape(n, H).mean(1)) + 1e-9)

H = 0.02
E = json.load(open('edit.json', encoding='utf-8'))
SP = E.get('speed', 1.0)
K = [(k['s'], k['e'], k.get('gainDb', 0)) for k in E['keep']]   # 조각마다 따로 올린 이득만큼 문턱도 올려 잰다
RUNS = [tuple(r) for r in json.load(open('speech_map.json'))]
GAIN = 7.6                                  # 완성본에 더해진 고정 이득 (빌드 로그)
# 이음매 쉼을 0.30초(1.1배속 뒤 0.27)로 깎았으므로 덩이를 묶는 기준도 그보다 작아야 한다 (재편집 4)
STRONG, WEAK, GAP, MINLEN = -52 + GAIN, -60 + GAIN, 0.16, 0.10

exp, acc, cut = [], 0.0, []
for s, e, gdb in K:
    for r0, r1 in RUNS:
        a, b = max(r0, s), min(r1, e)
        if b - a > 0.08:
            exp.append(((acc + a - s) / SP, (acc + b - s) / SP, r0, r1, a > r0 + 0.02 or b < r1 - 0.02, gdb))
    acc += e - s
D = env('fin_audio.wav')
SRC = env('src_audio.wav')
SRCB = env('src_level.wav')
# 견줄 때는 **양쪽 다 전대역**으로 잰다. 원본만 대역 트랙을 섞어 재면 문턱 언저리 칸이 원본 쪽에서만
# 세어져 완성본이 늘 0.1-0.2초 짧아 보인다 (퍼리 취향 1차 2026-09-28, 헛경보 1건)
SRCM = SRC

def talk(arr, a, b, thr):      # [a,b) 안에서 문턱을 넘는 시간(초)
    return float((arr[int(a/H):int(b/H)] > thr).sum()) * H

# 덩이를 맞춰 세는 대신 **말한 시간**을 견준다 (이음매 쉼을 0.27초로 깎으니 덩이가 서로 붙어 못 맞춘다).
# 컷이 낱말을 물면 완성본 쪽 말 시간이 그만큼 짧아진다.
print('원본 덩이            -> 완성본 자리        말 시간(원본/완성본, 배속 보정)')
bad = 0
for a, b, r0, r1, trimmed, gdb in exp:
    want = talk(SRCM, max(r0, 0), r1, -52)
    if trimmed:                 # 일부만 쓴 덩이는 쓴 만큼만 견준다
        pass
    got_s = talk(D, a - 0.05, b + 0.05, -52 + GAIN + gdb)
    src_s = talk(SRCM, max(r0 if not trimmed else 0, 0), r1, -52) if not trimmed else None
    if trimmed:
        src_s = None
        f = '  [덩이 일부만 씀 - 건너뜀]'
    else:
        d = got_s * SP - src_s
        # 원본은 -52dB, 완성본은 이득 +7.6 을 뺀 값으로 재니 문턱 언저리 칸이 몇 개씩 다르게 세어진다.
        tol = max(0.10, 0.025 * (r1 - r0))
        f = '' if abs(d) <= tol else '  <== 말이 %.2f초 %s' % (abs(d), '모자람' if d < 0 else '더 남')
        if f: bad += 1
    print('  %5.2f-%5.2f -> %5.2f-%5.2f   %s / %.2f%s'
          % (r0, r1, a, b, ('%.2f' % src_s) if src_s is not None else '   -', got_s * SP, f))
print('')
print('말이 깎인 덩이 %d개' % bad)
