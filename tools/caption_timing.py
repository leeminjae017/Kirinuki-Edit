# -*- coding: utf-8 -*-
"""참고본에서 '자막이 언제 뜨는가'만 잰다. 쓰는 법: python ana.py <파일>"""
import subprocess, sys, os, numpy as np
from PIL import Image
sys.stdout.reconfigure(encoding="utf-8")
SRC = sys.argv[1]
tag = os.path.splitext(os.path.basename(SRC))[0][:6]

info = subprocess.run(["ffprobe","-v","error","-select_streams","v:0",
    "-show_entries","stream=width,height,r_frame_rate,duration","-of","csv=p=0",SRC],
    capture_output=True, text=True).stdout.strip().split(",")
W0,H0 = int(info[0]), int(info[1])
FPS = eval(info[2]); DUR = float(info[3])
print("%s  %dx%d %.0ffps %.1f초" % (os.path.basename(SRC), W0,H0,FPS,DUR))

# --- 자막 띠 찾기: 여섯 프레임의 '검은 픽셀' 행 프로필 ---
x0, xw = int(W0*0.20), int(W0*0.60)
acc = np.zeros(H0)
for f in (0.2,0.32,0.44,0.56,0.68,0.8):
    p = subprocess.run(["ffmpeg","-v","error","-ss","%.2f"%(DUR*f),"-i",SRC,
        "-frames:v","1","-f","image2pipe","-vcodec","png","-"],capture_output=True)
    import io as _io
    im = np.asarray(Image.open(_io.BytesIO(p.stdout)).convert("RGB")).astype(int)
    R,G,B = im[:,x0:x0+xw,0], im[:,x0:x0+xw,1], im[:,x0:x0+xw,2]
    acc += ((R<60)&(G<60)&(B<60)).sum(1)
k = int(np.argmax(np.convolve(acc, np.ones(40), "same")))
y0 = max(0, k-70); yh = min(H0-y0, 150)
print("  자막 띠 y %d-%d (x %d-%d)" % (y0,y0+yh,x0,x0+xw))

# --- 잉크(자막 외곽선) ---
w,h = 300,32
vf = ("crop=%d:%d:%d:%d,format=gray,lut=y='if(lt(val\,60)\,255\,0)',scale=%d:%d"
      % (xw,yh,x0,y0,w,h))
p = subprocess.run(["ffmpeg","-v","error","-i",SRC,"-vf",vf,"-f","rawvideo","-"],capture_output=True)
v = np.frombuffer(p.stdout,dtype=np.uint8); n = len(v)//(w*h)
v = v[:n*w*h].reshape(n,h,w).astype(np.float32)
ink = v.sum(axis=(1,2))/255.0

# --- 소리 (말소리 대역) ---
wav = "%s.wav"%tag
subprocess.run(["ffmpeg","-v","error","-y","-i",SRC,"-ac","1","-ar","16000",
    "-af","highpass=f=700,lowpass=f=3000",wav],check=True)
import wave
wf=wave.open(wav); a=np.frombuffer(wf.readframes(wf.getnframes()),dtype=np.int16).astype(np.float32)/32768.0
HOP=0.01; F=int(16000*HOP); m=len(a)//F
rms=np.sqrt((a[:m*F].reshape(m,F)**2).mean(1))
sm=np.median(np.stack([np.roll(rms,k) for k in(-1,0,1)]),axis=0)
THR=np.percentile(sm,50)
LO=max(60.0, np.percentile(ink,50)*0.12)
print("  자막 있는 프레임 %.0f%% · 문턱 %.0f" % (100*(ink>LO).mean(), LO))

def voice_start(t):
    c=min(m-1,int(t/HOP))
    if sm[c]>THR:
        j=c
        while j>0 and sm[j]>THR: j-=1
        return j*HOP
    k=c
    while k<m and sm[k]<=THR: k+=1
    return k*HOP if k<m else None

on=[]; rise=[]; settle_off=[]
i=1
while i<n:
    if ink[i]>LO and ink[i-1]<=LO:
        seg=ink[i:min(n,i+36)]; top=seg.max()
        st=i+int(np.argmax(seg>=0.9*top))
        t=i/FPS; vs=voice_start(t)
        if vs is not None:
            on.append(t-vs); rise.append(st/FPS-t); settle_off.append(st/FPS-vs)
        i=st+1
    i+=1
on=np.array(on); rise=np.array(rise); so=np.array(settle_off)
def med(x): return np.median(x) if len(x) else float("nan")
print("  [뜰 때 %d건] 자막-소리 중앙값 %+.3f · 이른 것 %d%% · |차|<0.1 %d%%"
      %(len(on),med(on),100*(on<0).mean(),100*(np.abs(on)<0.1).mean()))
print("  [애니] 굳는 데 중앙값 %.3f초 (%.1f프레임) · **굳는 순간-소리 %+.3f**"
      %(med(rise),med(rise)*FPS,med(so)))

d=np.abs(np.diff(v,axis=0)).mean(axis=(1,2)); d=np.concatenate([[0.0],d])
idx=np.where(d>12)[0]; ev=[]; last=-99
for i in idx:
    if i-last>12: ev.append(i)
    last=i
ev=[i for i in ev if ink[i]>LO and ink[max(0,i-12)]>LO]
vals=[];nxt=[]
for i in ev:
    c=int(i/FPS/HOP)
    if c<30 or c+30>=m: continue
    win=sm[c-30:c+31]; vals.append(sm[c]/(win.max() or 1))
    k=c
    while k<m and sm[k]<=THR: k+=1
    nxt.append((k-c)*HOP)
vals=np.array(vals); nxt=np.array(nxt)
if len(vals):
    print("  [줄 바뀜 %d건] 골에서 %d%% (크기 %.2f) · 바뀐 뒤 다음 말까지 중앙값 %.2f초"
          %(len(vals),100*(vals<0.5).mean(),med(vals),med(nxt)))
offs=[];state=False
for i,x in enumerate(ink):
    if not state and x>LO: state=True
    elif state and x<LO: offs.append(i); state=False
r2=[]
for i in offs:
    t=i/FPS; c=min(m-1,int(t/HOP)); j=c
    while j>0 and sm[j]<=THR: j-=1
    r2.append(t-j*HOP)
r2=np.array(r2)
if len(r2): print("  [사라질 때 %d건] 말끝 대비 중앙값 %+.2f초 · 평균 %+.2f"%(len(r2),med(r2),r2.mean()))
