import React from 'react';
import { AbsoluteFill, Img, OffthreadVideo, Sequence, Video, useCurrentFrame, useVideoConfig } from 'remotion';
import { colorCss, ToneDefs } from './Layers';
import { isSlide, isXf, transIn, transOut } from '../../lib/trans.mjs';
import { Env, Fx, Scene, abs, on } from '../scene';

/* Window = the cut source video. Zoom, push, shake and mono are CSS versions of the ffmpeg graph in lib/render.mjs
   (keep both in sync). Nesting from outside: mono > shake > push > zoom, the reverse of the ffmpeg filter order.
   Used for the dashboard preview only - final renders draw the window in ffmpeg. */

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/* Preview playback: the window video carries the audio. Pausing the whole player whenever one video buffers, and
   re-seeking on small drift, made the preview jump back and repeat words (2026-09-17). The background is decoration,
   so it may drift freely; the window re-syncs past 0.3s (0.5 left a steady 0.35s audio lead over the captions; 0.2 re-seeked once right after play). */
export const Media: React.FC<{ src: string; env: Env; muted?: boolean; style?: React.CSSProperties; startFrom?: number; loop?: boolean; drift?: number }> =
  ({ src, env, muted, style, startFrom, loop, drift = 0.3 }) => {
    const url = env.url(src);
    if (/\.(png|jpe?g|webp)$/i.test(src)) return <Img src={url} style={style} />;
    return env.preview
      ? <Video src={url} muted={muted} style={style} startFrom={startFrom} loop={loop} acceptableTimeShiftInSeconds={drift} />
      : <OffthreadVideo src={url} muted={muted} style={style} startFrom={startFrom} />;
  };

export const WindowView: React.FC<{ scene: Scene; env: Env; t: number }> = ({ scene, env, t }) => {
  const { fps } = useVideoConfig();
  const W = scene.window, fx = (scene.fx || []).filter((f) => on(t, f.s, f.e));
  const face = scene.face || [W.x + W.w / 2, W.y + W.h / 2];
  const fxl = (face[0] - W.x) / W.w, fyl = (face[1] - W.y) / W.h;
  const get = <T extends Fx['type']>(ty: T) => fx.find((f) => f.type === ty) as Extract<Fx, { type: T }> | undefined;

  let transform = '';
  const zoom = get('zoom');
  if (zoom) {                                      // crop around the face, pushed back inside the window
    const cw = W.w / zoom.z, ch = W.h / zoom.z;
    const cx = clamp(face[0] - W.x - cw / 2, 0, W.w - cw), cy = clamp(face[1] - W.y - ch / 2, 0, W.h - ch);
    transform = `translate(${-cx * zoom.z}px, ${-cy * zoom.z}px) scale(${zoom.z})`;
  }
  const push = get('push');
  let pushT = '';
  if (push) {
    const u = clamp((t - push.s) / Math.max(0.01, push.e - push.s), 0, 1), z = push.z0 + (push.z1 - push.z0) * u;
    pushT = `translate(${-(z - 1) * W.w * fxl}px, ${-(z - 1) * W.h * fyl}px) scale(${z})`;
  }
  const shake = get('shake');
  let shakeT = '';
  if (shake) {
    const S = scene.style.effects?.shake ?? { amp: 12, hz: 14, zoom: 1.06 }, amp = shake.amp ?? S.amp, hz = shake.hz ?? S.hz;
    const mx = (W.w * S.zoom - W.w) / 2, my = (W.h * S.zoom - W.h) / 2;
    const dx = mx + Math.min(amp, mx) * Math.sin(2 * Math.PI * hz * t), dy = my + Math.min(amp, my) * Math.cos(2 * Math.PI * hz * t * 1.3);
    shakeT = `translate(${-dx}px, ${-dy}px) scale(${S.zoom})`;
  }
  const mono = get('mono');
  const blur = get('blur');
  const flip = get('hflip'), vig = get('vignette'), flash = get('flash');
  const fl = flash ? Math.max(0, 1 - (t - flash.s) / (flash.d ?? 0.3)) * (flash.k ?? 0.6) : 0;   // ffmpeg eq brightness adds; CSS multiplies - close enough
  const layer: React.CSSProperties = { position: 'absolute', left: 0, top: 0, width: W.w, height: W.h, transformOrigin: '0 0' };
  const win = scene.body.windowPreview && env.preview ? scene.body.windowPreview : scene.body.window;

  return (
    <div style={{ position: 'absolute', left: W.x, top: W.y, width: W.w, height: W.h, overflow: 'hidden', filter: [mono ? 'grayscale(1)' : '', blur ? `blur(${blur.sigma}px)` : '', fl > 0 ? `brightness(${(1 + 2 * fl).toFixed(3)})` : ''].join(' ').trim() || undefined }}>
      <div style={{ ...layer, transform: shakeT || undefined }}>
        <div style={{ ...layer, transform: pushT || undefined }}>
          <div style={{ ...layer, transform: transform || undefined }}>
            <div style={{ ...layer, transformOrigin: '50% 50%', transform: flip ? 'scaleX(-1)' : undefined }}>
              {env.preview && scene.plan
                ? <PlanWindow scene={scene} env={env} fps={fps} />
                : <Media src={abs(scene.dir, win)} env={env} style={{ width: W.w, height: W.h, display: 'block' }} />}
            </div>
          </div>
        </div>
      </div>
      {vig ? <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: 'radial-gradient(ellipse at center, rgba(0,0,0,0) 45%, rgba(0,0,0,0.65) 100%)' }} /> : null}
    </div>
  );
};

/* Planned edit, not rendered: one <Video> per kept source range, back to back (each premounted so the jump at a cut is
   short). The source copy is the whole frame; each range shows its piece's crop by scaling and shifting the frame so
   the crop fills the window. At a real cut (the next range does not continue the source) the sound crossfades like the
   render (lib/body.mjs): the outgoing range plays xf/2 past its end fading out, the incoming one starts xf/2 early fading
   in. The picture still cuts on the frame - the extra bits are hidden. Ranges that continue the source just butt.
   Between ranges that do not butt in time (a cut left open - ripple off in the dashboard) the window is black, like the
   { gap } piece the render puts there. */
const PlanWindow: React.FC<{ scene: Scene; env: Env; fps: number }> = ({ scene, env, fps }) => {
  const W = scene.window, P = scene.plan!, R = P.ranges;
  const h = Math.round(((P.xf ?? 0) / 2) * fps);
  const cutAt = (i: number) => i > 0 && i < R.length
    && (Math.abs(R[i - 1].e - R[i].s) > 0.01 || Math.abs(R[i - 1].at + (R[i - 1].e - R[i - 1].s) - R[i].at) > 0.01);
  /* transition into range i (dashboard user edit tab, 2026-10-02): centered on the cut, half its length from each side's
     handles - the same frames lib/body.mjs feeds to ffmpeg xfade, so the length and caption times do not change */
  const half = (i: number) => {
    const t = i > 0 && i < R.length && cutAt(i) ? R[i].tin : null;
    if (!t || !t.d) return 0;
    const A = R[i - 1], B = R[i];
    return Math.max(0, Math.round(Math.min(t.d / 2, B.s, (A.e - A.s) / 2, (B.e - B.s) / 2) * fps));
  };
  return (
    <>
      <div style={{ position: 'absolute', left: 0, top: 0, width: W.w, height: W.h, background: '#000' }} />
      {R.map((r, i) => (r.tin && r.tin.type === 'white' && half(i)
        ? <Sequence key={'wt' + i} from={Math.round(r.at * fps) - half(i)} durationInFrames={2 * half(i)}>
            <div style={{ position: 'absolute', left: 0, top: 0, width: W.w, height: W.h, background: '#fff' }} />
          </Sequence> : null))}
      {R.map((r, i) => {
        const from = Math.round(r.at * fps), len = Math.max(1, Math.round((r.e - r.s) * fps));
        const t0 = Math.min(half(i), from), t1 = half(i + 1);
        const a0 = cutAt(i) ? Math.min(h, from, Math.round(r.s * fps)) : 0, a1 = cutAt(i + 1) ? h : 0;   // sound crossfade (render: 0.15s)
        const h0 = Math.max(a0, t0), h1 = Math.max(a1, t1);
        return (
          <Sequence key={i + ':' + r.s} from={from - h0} durationInFrames={len + h0 + h1} premountFor={Math.round(fps * 0.6)}>
            <PlanRange scene={scene} env={env} fps={fps} r={r} len={len} h0={h0} h1={h1} a0={a0} a1={a1} t0={t0} t1={t1}
              tin={t0 ? r.tin!.type : null} tout={t1 ? R[i + 1].tin!.type : null} z={i} />
          </Sequence>
        );
      })}
    </>
  );
};

type PlanR = NonNullable<Scene['plan']>['ranges'][number];
/* user move / zoom on the window picture (dashboard, 2026-10-03) as a new source crop - same math as tfCropVf in lib/body.mjs:
   the visible part of the crop at window aspect, zoomed about the centre and panned by (x, y) window px. Outside the source the
   window stays black (the render pads with black). Rotation is a CSS rotate about the window centre (ffmpeg rotate there). */
const tfCrop = (c: { x: number; y: number; w: number; h: number }, tf: { x: number; y: number; z: number }, WW: number, WH: number) => {
  if (!tf.x && !tf.y && Math.abs(tf.z - 1) < 1e-4) return c;
  const A = WW / WH;
  const V = c.w / c.h > A ? { w: c.h * A, h: c.h } : { w: c.w, h: c.w / A };
  const vx = c.x + (c.w - V.w) / 2, vy = c.y + (c.h - V.h) / 2, s = V.w / WW, z = Math.max(0.05, tf.z);
  const w = V.w / z, h = V.h / z;
  return { x: vx + V.w / 2 - tf.x * s / z - w / 2, y: vy + V.h / 2 - tf.y * s / z - h / 2, w, h };
};
/* camera box at source second t - the same as cameraSpans in lib/body.mjs: a key holds until the next, a next key with
   in: "linear" is reached at constant speed; box width = h * window aspect, kept inside the source */
type CamK = NonNullable<NonNullable<Scene['plan']>['camera']>[number];
const camBox = (K: CamK[], t: number, aspect: number, SW: number, SH: number) => {
  let lo = 0, hi = K.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (K[m].t <= t + 1e-6) lo = m; else hi = m - 1; }
  const a = K[lo], b = K[lo + 1];
  let x = a.x, y = a.y, h = a.h;
  if (t >= a.t - 1e-6 && b && b.in === 'linear') {
    const u = (t - a.t) / Math.max(1e-6, b.t - a.t);
    x += (b.x - a.x) * u; y += (b.y - a.y) * u; h += (b.h - a.h) * u;
  }
  h = Math.min(SH, h);
  const w = Math.min(SW, h * aspect);
  return { x: clamp(x, 0, SW - w), y: clamp(y, 0, SH - h), w, h };
};
type Tr = string | null;
const PlanRange: React.FC<{ scene: Scene; env: Env; fps: number; r: PlanR; len: number; h0: number; h1: number;
                            a0: number; a1: number; t0: number; t1: number; tin: Tr; tout: Tr; z: number }> =
  ({ scene, env, fps, r, len, h0, h1, a0, a1, t0, t1, tin, tout }) => {
    const W = scene.window, P = scene.plan!, f = useCurrentFrame();
    const crop0 = P.camera && P.camera.length ? camBox(P.camera, r.s + (f - h0) / fps, W.w / W.h, P.srcW, P.srcH) : r.crop;
    const tf = { x: 0, y: 0, z: 1, r: 0, ...(r.tf || {}) };
    const crop = tfCrop(crop0, tf, W.w, W.h);
    const k = W.w / crop.w, v = r.vol ?? 1;
    const vol = (x: number) => {                 // the sound crossfade at a cut stays the render's 0.15s, not the picture transition
      if (x < h0 - a0) return 0;
      if (a0 && x < h0 + a0) return v * clamp((x - (h0 - a0)) / (2 * a0), 0, 1);
      if (x >= h0 + len + a1) return 0;
      if (a1 && x > h0 + len - a1) return v * clamp((h0 + len + a1 - x) / (2 * a1), 0, 1);
      return v;
    };
    // picture: a plain cut shows only its own frames; a transition widens that by t0 / t1 on each side
    let op = f >= h0 && f < h0 + len ? 1 : 0, clip: string | undefined, dx = 0, dy = 0;
    if (tin && f >= h0 - t0 && f < h0 + t0) {          // coming in (drawn over the outgoing range)
      const p = (f - (h0 - t0)) / (2 * t0);
      if (tin === 'dissolve') op = p;
      else if (tin === 'black' || tin === 'white') op = f < h0 ? 0 : (f - h0) / t0;
      else if (isXf(tin)) { op = 1; const q = transIn(tin, p, W.w, W.h); clip = q.clip; dx = q.dx; dy = q.dy; }
    }
    if (tout && f >= h0 + len - t1 && f < h0 + len + t1) {   // going out (under the incoming range)
      if (tout === 'black' || tout === 'white') op = f >= h0 + len ? 0 : 1 - (f - (h0 + len - t1)) / t1;
      else if (isSlide(tout)) { op = 1; const q = transOut(tout, (f - (h0 + len - t1)) / (2 * t1), W.w, W.h); dx = q.dx; dy = q.dy; }
      else op = 1;
    }
    return (
      <div style={{ position: 'absolute', left: dx, top: dy, width: W.w, height: W.h, overflow: 'hidden', opacity: op, clipPath: clip }}>   {/* no zIndex - it lifted the video over the caption layer */}
        <ToneDefs c={r.color} />
        <div style={{ position: 'absolute', inset: 0, transform: tf.r ? `rotate(${tf.r}deg)` : undefined, opacity: r.vhide ? 0 : 1 }}>
          <Video src={env.url(abs(scene.dir, P.src))} startFrom={Math.round(r.s * fps) - h0} volume={vol}
            acceptableTimeShiftInSeconds={0.3}
            style={{ position: 'absolute', left: -crop.x * k, top: -crop.y * k, width: P.srcW * k, height: P.srcH * k, maxWidth: 'none',
                     filter: colorCss({ color: r.color }) }} />
        </div>
      </div>
    );
  };

export const Background: React.FC<{ scene: Scene; env: Env }> = ({ scene, env }) => {
  const { fps } = useVideoConfig();
  const bg = scene.body.bgPreview && env.preview ? scene.body.bgPreview : scene.body.bg;
  if (!bg) return <AbsoluteFill style={{ background: '#000' }} />;
  return (
    <AbsoluteFill>
      <Media src={abs(scene.dir, bg)} env={env} muted loop drift={10}
        style={{ width: scene.width, height: scene.height }} />
    </AbsoluteFill>
  );
};
