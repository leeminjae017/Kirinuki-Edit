# -*- coding: utf-8 -*-
"""음절 봉우리로 자막 시각을 잡는다 (재편집 3 2026-09-27).

사용자: "자막이랑 말이랑 매칭이 이상해" (3판째). 위스퍼 낱말 시각은 쉼 앞뒤에서 0.2-0.4초씩 어긋나
그걸로는 못 맞춘다. 대신 **글자 수를 안다**는 것을 쓴다 - 한글 한 음절 = 소리 봉우리 하나.
말 덩이마다 봉우리를 세어 글자 수와 맞추고, 줄 첫 글자의 봉우리에서 닿소리 몫만큼 앞으로 당긴다.
"""
import numpy as np, wave, re

def env(path='src_audio.wav', hop=0.01):
    w = wave.open(path); sr = w.getframerate()
    x = np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(float) / 32768
    H = int(hop * sr); n = len(x) // H
    return 20 * np.log10(np.sqrt((x[:n*H] ** 2).reshape(n, H).mean(1)) + 1e-9), hop

DB, HOP = env()
BAND, _ = env('src_level.wav')
E = np.maximum(DB, BAND - 6)
K = np.array([1, 2, 3, 2, 1], float); K /= K.sum()
S = np.convolve(E, K, 'same')                      # 50ms 다듬기 - 음절 안 잔물결을 지운다
n = len(S)
syl = lambda t: len(re.findall(r'[가-힣]', t))

def peaks(a, b, want):
    """[a,b) 안에서 봉우리 want 개. 돌출(앞뒤 골과의 차)이 큰 순으로 고르고 시간순으로 돌려준다"""
    i0, i1 = int(a / HOP), min(n, int(b / HOP))
    seg = S[i0:i1]
    cand = []
    for i in range(1, len(seg) - 1):
        if seg[i] >= seg[i-1] and seg[i] > seg[i+1]:
            l = seg[:i].min() if i else seg[i]
            r = seg[i+1:].min() if i + 1 < len(seg) else seg[i]
            j = i
            while j > 0 and seg[j-1] < seg[j]: j -= 1
            k = i
            while k < len(seg) - 1 and seg[k+1] < seg[k]: k += 1
            prom = seg[i] - max(seg[j], seg[k])
            cand.append((prom, i))
    cand.sort(reverse=True)
    out = []
    for prom, i in cand:
        if all(abs(i - j) >= 6 for _, j in out):    # 봉우리끼리 0.06초 이상 떨어뜨린다
            out.append((prom, i))
        if len(out) == want: break
    return sorted((i0 + i) * HOP for _, i in out), len(cand)

def valley_before(t, back=0.16):
    """봉우리 앞 골 = 닿소리가 시작하는 자리"""
    i = int(t / HOP); j = max(0, int((t - back) / HOP))
    if j >= i: return t
    return (j + int(np.argmin(S[j:i]))) * HOP
