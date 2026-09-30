import React from 'react';
import { Img } from 'remotion';
import { Env, Overlay, Scene, abs } from '../scene';
import { textWidth } from '../fonts';

/* Images and chat cards grow from 70% to 100% over preset.image.popSec. */
const pop = (t: number, s: number, sec: number) => Math.min(1, 0.7 + 0.3 * Math.max(0, t - s) / sec);

/* triangle wave 0..1..0 over `period` seconds (constant speed, as instructed - not a sine) */
export const tri = (t: number, period: number) => 1 - Math.abs(2 * (((t / period) % 1) + 1) % 1 - 1);

export const ImageView: React.FC<{ o: Extract<Overlay, { type: 'image' }>; scene: Scene; env: Env; t: number }> = ({ o, scene, env, t }) => {
  const w = o.w * (o.pop === false ? 1 : pop(t, o.s, scene.style.image?.popSec ?? 0.14));
  const bob = o.bounce ? o.bounce.amp * tri(t, o.bounce.period) : 0;
  // spin: one turn per `period` seconds, starting at spin.s (a tool that turns while the host says so)
  const deg = o.spin && t >= o.spin.s ? (360 * (t - o.spin.s)) / o.spin.period : 0;
  const tl = o.anchor === 'topleft';
  return (
    <Img src={env.url(abs(scene.dir, o.src))}
      style={{ position: 'absolute', width: w, left: tl ? o.x : o.x - w / 2, top: o.y - bob, transform: [tl ? '' : 'translateY(-50%)', deg ? `rotate(${deg.toFixed(1)}deg)` : ''].filter(Boolean).join(' ') || undefined,
               border: o.border ? `${o.border}px solid white` : undefined, boxSizing: 'content-box' }} />
  );
};

/* Speech bubble: rounded box plus an optional tail polygon (roleplay inserts). */
export const BubbleView: React.FC<{ o: Extract<Overlay, { type: 'bubble' }>; scene: Scene }> = ({ o, scene }) => {
  const [x1, y1, x2, y2] = o.box, r = o.radius ?? 48;
  const fill = o.fill || '#FDFDFD', st = o.stroke;
  return (
    <svg width={scene.width} height={scene.height} style={{ position: 'absolute', inset: 0 }}>
      {o.tail && <polygon points={o.tail.map((p) => p.join(',')).join(' ')} fill={fill} stroke={st?.color} strokeWidth={st ? 2 * st.width : 0} strokeLinejoin="round" />}
      <rect x={x1} y={y1} width={x2 - x1} height={y2 - y1} rx={r} fill={fill} stroke={st?.color} strokeWidth={st ? 2 * st.width : 0} />
      {o.tail && st && <polygon points={o.tail.map((p) => p.join(',')).join(' ')} fill={fill} />}
    </svg>
  );
};

/* Insert: covers the canvas with a background image (scaled from the center) and shows a still cut from the
   source, enlarged to min(maxW/w, maxH/h, maxZoom) and centered. */
export const InsertView: React.FC<{ o: Extract<Overlay, { type: 'insert' }>; scene: Scene; env: Env }> = ({ o, scene, env }) => {
  const z = Math.min(o.maxW / o.srcW, o.maxH / o.srcH, o.maxZoom);
  const w = o.srcW * z, h = o.srcH * z, bs = o.background?.scale ?? 1;
  /* area 'window': only the video window is covered, the preset background around it stays */
  /* 2px pad: ffmpeg places the window on even rows (407 -> 406), so an exact box left a 1px line of video above it */
  const B = o.area === 'window' ? { x: scene.window.x, y: scene.window.y - 2, w: scene.window.w, h: scene.window.h + 4 } : { x: 0, y: 0, w: scene.width, h: scene.height };
  return (
    <div style={{ position: 'absolute', left: B.x, top: B.y, width: B.w, height: B.h, overflow: 'hidden', background: '#000' }}>
      {o.background && <Img src={env.url(abs(scene.dir, o.background.src))}
        style={{ position: 'absolute', width: B.w * bs, height: B.h * bs, left: -(bs - 1) * B.w / 2, top: -(bs - 1) * B.h / 2, objectFit: 'cover' }} />}
      <Img src={env.url(abs(scene.dir, o.src))} style={{ position: 'absolute', width: w, height: h, left: (B.w - w) / 2, top: (B.h - h) / 2 }} />
    </div>
  );
};

/* Chat card: rounded box with a colored border, optional icon on the left, one or two lines of text.
   Drawn at preset size and scaled - one scale for every card keeps the text size equal across cards. */
export const ChatView: React.FC<{ o: Extract<Overlay, { type: 'chat' }>; scene: Scene; env: Env; t: number }> = ({ o, scene, env, t }) => {
  const L = scene.style.chat;
  if (!L) return null;
  const f = scene.style.fonts[L.font];
  const size = o.lines.length > 1 ? L.size2 : L.size1;
  const tw = Math.max(...o.lines.map((l) => textWidth(l, f.family, size)));
  const W = L.textX + tw + L.padRight;
  const maxW = o.maxW ?? L.maxWidth;
  let k = o.scale ?? L.scale;
  if (W * k > maxW) k = maxW / W;
  k *= pop(t, o.s, scene.style.image?.popSec ?? 0.14);
  const lh = size * 1.12;
  return (
    <div style={{ position: 'absolute', left: (o.x ?? scene.width / 2) - W / 2, top: (o.y ?? L.y) - L.height / 2, width: W, height: L.height,
                  transform: `scale(${k})`, transformOrigin: '50% 50%' }}>
      <div style={{ position: 'absolute', inset: 0, background: L.borderColor, borderRadius: L.radius }} />
      <div style={{ position: 'absolute', inset: L.border, background: L.fill, borderRadius: Math.max(0, L.radius - 14) }} />
      {L.icon?.path && <Img src={env.url(L.icon.path)} style={{ position: 'absolute', left: L.icon.box[0], top: L.icon.box[1], width: L.icon.box[2], height: L.icon.box[3] }} />}
      <div style={{ position: 'absolute', left: L.textX, top: L.height / 2 - lh * o.lines.length / 2, fontFamily: `"${f.family}"`,
                    fontSize: size, lineHeight: `${lh}px`, color: L.textColor, whiteSpace: 'pre' }}>
        {o.lines.map((l, i) => <div key={i}>{l}</div>)}
      </div>
    </div>
  );
};
