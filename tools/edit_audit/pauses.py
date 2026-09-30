# -*- coding: utf-8 -*-
"""완성본 쉼이 자막 묶음과 맞는지 (재편집 6 2026-09-27).

사용자가 네 판 내리 "묶음" 을 지적했다. 시청자는 **쉼의 길이**로 말을 묶어 듣는다 -
큰 쉼(0.45초 이상)은 줄이 바뀌는 자리에 와야 하고, 줄 안의 쉼은 그 줄 양끝 쉼보다 짧아야 한다.
"""
import csv, json, numpy as np, wave

w = wave.open('fin_audio.wav'); sr = w.getframerate()
x = np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(float) / 32768
H = int(0.02 * sr); n = len(x) // H
db = 20 * np.log10(np.sqrt((x[:n*H] ** 2).reshape(n, H).mean(1)) + 1e-9)
on = db > -45
runs, i = [], 0
while i < n:
    if on[i]:
        j = i
        while j + 1 < n and on[j + 1]: j += 1
        runs.append([i * 0.02, (j + 1) * 0.02]); i = j + 1
    else: i += 1
m = []
for a, b in runs:
    if m and a - m[-1][1] < 0.14: m[-1][1] = b
    else: m.append([a, b])
m = [(round(a, 2), round(b, 2)) for a, b in m if b - a >= 0.10]

rows = [r for r in csv.DictReader(open('captions.csv', encoding='utf-8-sig')) if r['speaker'] != '제목']
hms = lambda s: sum(f * float(v) for f, v in zip((3600, 60, 1), s.split(':')))
SP = json.load(open('edit.json', encoding='utf-8')).get('speed', 1.0)
L = [(hms(r['start']) / SP, r['text']) for r in rows]   # 배속은 edit.json 에서. 1.1 을 박아 두었더니
                                                        # 1.0 인 편에서 줄 시각이 통째로 어긋나 헛경보가 났다 (퍼리 취향 1차)
bad = []
print('완성본 쉼 0.2초 이상')
for (a, b), (c, d) in zip(m, m[1:]):
    g = c - b
    if g < 0.2: continue
    at_line = [t for t, _ in L if b - 0.15 <= t <= c + 0.30]
    who = next((x for t, x in L if b - 0.15 <= t <= c + 0.30), None)
    flag = ''
    # 줄 안의 큰 쉼 두 곳은 일부러 둔 것 - 거기서 컷을 내면 자세가 튀고, 사용자는 **장면**으로 묶어 읽는다
    # ("이게 슈트가 아니에요" 1.08초 · "오늘 여러분 제가 슈트를" 0.58초). 한 장면 안에 있으면 쉼이 길어도 묶인다
    prev = [x for t, x in L if t <= b + 0.05]
    WHITE = ()      # 일부러 둔 줄 안의 큰 쉼 - 편마다 다시 적는다 (프젝아 모캡: '이게 슈트가 아니에요' · '오늘 여러분 제가 슈트를')
    if not at_line and g >= 0.45 and not (prev and prev[-1] in WHITE):
        flag = '  <== 큰 쉼인데 줄 안이다 (묶음이 깨진다)'
        bad.append((b, g))
    print('  %5.2f  쉼 %.2f  %s%s' % (b, g, ('줄 바뀜: ' + who) if who else '줄 안', flag))
print('')
print('묶음이 깨지는 자리 %d곳' % len(bad))
