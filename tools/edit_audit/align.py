# -*- coding: utf-8 -*-
"""자막 줄 시각을 **말 토막에 글자를 나눠 담아** 정한다 (재편집 3 2026-09-27).

사용자 "자막이랑 말이랑 매칭이 이상해" (세 판째). 그동안은 위스퍼 낱말 시각을 썼는데 이 소스에서 0.2-0.9초씩 틀렸다.
음절 봉우리를 세는 것도 해 봤지만 봉우리 수가 글자 수와 안 맞았다 (29글자 덩이에서 16개).
그래서 **덩이 안의 작은 쉼으로 토막을 내고, 글자를 토막에 순서대로 나눠 담되 말 속도가 고르게** 되도록 푼다.
토막 길이는 잰 값이고, 글자 수는 확실히 아는 값이다 - 둘을 맞추면 줄 시작 자리가 나온다.
"""
import numpy as np, re
from syllables import S, HOP, syl

THR, GAP, MINLEN = -55, 0.11, 0.08

def subs(a, b):
    """[a,b] 안의 말 토막 (잔 쉼 GAP 로 나눔)"""
    i0, i1 = int(a / HOP), int(b / HOP)
    on = S[i0:i1] > THR
    out, i = [], 0
    while i < len(on):
        if on[i]:
            j = i
            while j + 1 < len(on) and on[j + 1]: j += 1
            s, e = (i0 + i) * HOP, (i0 + j + 1) * HOP
            if out and s - out[-1][1] < GAP: out[-1][1] = e
            else: out.append([s, e])
            i = j + 1
        else: i += 1
    return [(round(x, 2), round(y, 2)) for x, y in out if y - x >= MINLEN]

def split(chunks, counts):
    """글자 수 N 을 토막들에 순서대로 나눠 담는다. 비용 = 토막마다 (길이 - 글자/속도)^2, 속도는 전체 평균.
    각 토막에 적어도 한 글자. DP 로 최적 분배를 찾는다."""
    N = sum(counts) if isinstance(counts, list) else counts
    C = len(chunks)
    if C == 0 or N < C: return None
    dur = [e - s for s, e in chunks]
    rate = N / sum(dur)
    INF = 1e18
    best = [[INF] * (N + 1) for _ in range(C + 1)]
    back = [[0] * (N + 1) for _ in range(C + 1)]
    best[0][0] = 0
    for c in range(1, C + 1):
        for n in range(c, N - (C - c) + 1):
            for k in range(1, n - (c - 1) + 1):        # 이 토막에 k 글자
                p = best[c - 1][n - k]
                if p >= INF: continue
                v = p + (dur[c - 1] - k / rate) ** 2
                if v < best[c][n]: best[c][n], back[c][n] = v, k
    if best[C][N] >= INF: return None
    take, n = [], N
    for c in range(C, 0, -1):
        k = back[c][n]; take.append(k); n -= k
    return list(reversed(take)), rate

def line_times(run, lines):
    """lines = [(글, ...)] 순서대로. 줄마다 시작 시각을 돌려준다"""
    ch = subs(run[0] - 0.08, run[1] + 0.08)
    counts = [syl(t) for t in lines]
    N = sum(counts)
    r = split(ch, N)
    if not r: return None, ch, None
    take, rate = r
    # 글자 번호 -> 시각
    edges = []          # (글자번호, 시각)
    n = 0
    for (s, e), k in zip(ch, take):
        for i in range(k):
            edges.append((n + i, s + (e - s) * i / k))
        n += k
    edges.append((N, ch[-1][1]))
    pos, out = 0, []
    for c in counts:
        out.append(round(edges[pos][1], 2)); pos += c
    return out, ch, take
