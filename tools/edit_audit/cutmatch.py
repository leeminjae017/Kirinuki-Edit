# -*- coding: utf-8 -*-
"""컷 자리를 **화면이 가장 덜 튀는 곳**으로 고른다 (재편집 6 2026-09-27).

사용자가 세 판 내리 같은 말을 했다: "이랑 부분이 다음 컷으로 넘어감" · "이게가 다음 장면으로 넘어가버려".
쉼 한가운데를 아무 데나 자르면 앞뒤 프레임의 자세가 달라 **다른 장면처럼** 보인다.
쉼 안이라면 어디서 잘라도 소리는 같으므로, 자세가 가장 비슷한 짝을 골라 이어 붙인다.
"""
import subprocess, numpy as np, json

W = H = 64
FPS = 50
CROP = json.load(open('edit.json', encoding='utf-8'))['crop']
SRC = json.load(open('edit.json', encoding='utf-8'))['source']

def frames():
    cmd = ['ffmpeg', '-v', 'error', '-i', SRC, '-vf',
           'crop=%d:%d:%d:%d,fps=%d,scale=%d:%d,format=gray' % (CROP['w'], CROP['h'], CROP['x'], CROP['y'], FPS, W, H),
           '-f', 'rawvideo', '-']
    buf = subprocess.run(cmd, capture_output=True).stdout
    n = len(buf) // (W * H)
    return np.frombuffer(buf[:n*W*H], np.uint8).reshape(n, H, W).astype(np.int16)

F = frames() if __name__ != '_' else None

def diff(a, b):
    """8x8 칸으로 나눠 **가장 많이 바뀐 칸**. 평균으로 재면 팔만 움직이는 것을 놓친다
    (제가|슈트를 에서 평균 3.8 이라 안 보일 줄 알았는데 팔이 확 달라져 사용자가 잡아냈다).
    이웃 프레임끼리의 칸 최대차이는 중앙 2.0 · 90% 13.6 - 14 언저리면 평소 움직임 수준이다."""
    A = F[int(round(a*FPS))].reshape(8, 8, 8, 8).mean((1, 3))
    B = F[int(round(b*FPS))].reshape(8, 8, 8, 8).mean((1, 3))
    return float(np.abs(A - B).max())

def best(out_lo, out_hi, remove, step=0.02):
    """[out_lo,out_hi] 안에서 자를 자리를 찾는다. 뒤 조각은 그 자리 + remove 에서 시작한다"""
    cand = []
    t = out_lo
    while t <= out_hi:
        cand.append((diff(t, t + remove), round(t, 2)))
        t += step
    cand.sort()
    return cand[0], cand[-1]

if __name__ == '__main__':
    print('프레임 %d장 (%.1ffps, %dx%d, 크롭 적용)' % (len(F), FPS, W, H))
