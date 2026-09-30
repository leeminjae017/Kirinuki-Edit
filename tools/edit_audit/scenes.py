# -*- coding: utf-8 -*-
"""컷이 자막 줄 한가운데를 지나가지 않는지 (재편집 9 2026-09-27).

사용자가 다섯 판 내리 잡아낸 것: "이랑 부분이 다음 컷으로 넘어감" · "'이게'는 다음 장면으로 넘어감" ·
"'슈트를' 은 '오늘 여러분 제가' 와 같은 장면이어야 하는데 다음 장면으로 넘어간다".
**한 자막 줄은 한 장면 안에 있어야 한다.** 쉼(패딩)을 아무리 맞춰도 컷이 줄을 가르면 소용없다.
"""
import json, csv

K = [(k['s'], k['e']) for k in json.load(open('edit.json', encoding='utf-8'))['keep']]
SP = json.load(open('edit.json', encoding='utf-8')).get('speed', 1.0)
rows = [r for r in csv.DictReader(open('captions.csv', encoding='utf-8-sig')) if r['speaker'] != '제목']
hms = lambda s: sum(f * float(v) for f, v in zip((3600, 60, 1), s.split(':')))
L = [(hms(r['start']) / SP, r['text']) for r in rows]
E = [(hms(r['start']) / SP, hms(r['end']) / SP) for r in rows]

acc, bad = 0.0, 0
print('컷 자리마다 - 그때 자막이 바뀌는가')
for s, e in K[:-1]:
    acc += e - s
    j = acc / SP
    d, t, x = min((abs(t - j), t, x) for t, x in L)
    # 컷과 자막 교체가 0.25초 안이면 같은 자리. **자막이 아예 없는 자리를 지나가는 컷도 괜찮다**
    # (사용자가 일부러 지운 줄 자리). 줄 끝이 컷을 0.10초 넘기는 것은 깜빡임 막기라 안 센다
    over = any(a + 0.02 < j < b - 0.12 for a, b in E)
    ok = d <= 0.25 or not over
    bad += not ok
    print('  컷 %5.2f초  가장 가까운 자막 %5.2f (%+.2f) %-20s%s'
          % (j, t, t - j, x, '' if ok else '  <== 줄 한가운데를 지나간다'))
print('')
print('줄 한가운데를 지나가는 컷 %d개' % bad)
