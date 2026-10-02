import React from 'react';
import { Audio, Img, Sequence, Video, useCurrentFrame } from 'remotion';
import { Env, Layer, Scene, abs } from '../scene';

/* Extra tracks laid on the timeline by hand (dashboard user edit tab, 2026-10-02): video / image clips on V2.., audio on A2..
   Preview only - the render composites them with ffmpeg (lib/render.mjs) under the React overlay, so captions stay on top.
   Times are output seconds: the clip plays file seconds [s, e] from output second `at`. fin / fout fade the picture
   (opacity) or the sound (volume). The browser cannot raise volume past 1, so a + dB clip is previewed at 1. */
export const fadeAt = (L: Layer, t: number) => {
  const len = L.e - L.s;
  let k = 1;
  const x0 = (L.xin || 0) / 2;                          // a dissolve in starts the clip early - its own fade-in starts at the cut
  if (L.xin && t < L.xin) k = Math.min(k, Math.max(0, t / L.xin));
  if (L.fin && t - x0 < L.fin) k = Math.min(k, Math.max(0, (t - x0) / L.fin));
  if (L.fout && t > len - L.fout) k = Math.min(k, Math.max(0, (len - t) / L.fout));
  return k;
};

/* motion (2026-10-03): box keyframes, t = seconds into the clip; linear between keys (ease = smoothstep), held before the
   first and after the last. lib/render.mjs builds the same curve as an ffmpeg expression (perspective) - change both together. */
type Box = { x: number; y: number; w: number; h: number };
export const boxAt = (L: Layer, t: number, b: Box): Box => {
  const K = L.keys;
  if (!K || !K.length) return b;
  if (t <= K[0].t) return K[0];
  if (t >= K[K.length - 1].t) return K[K.length - 1];
  let i = 0;
  while (i + 2 < K.length && t >= K[i + 1].t) i++;
  const a = K[i], c = K[i + 1];
  let p = (t - a.t) / Math.max(1e-6, c.t - a.t);
  if (L.ease) p = p * p * (3 - 2 * p);
  return { x: a.x + (c.x - a.x) * p, y: a.y + (c.y - a.y) * p, w: a.w + (c.w - a.w) * p, h: a.h + (c.h - a.h) * p };
};

/* transitions between extra clips on one track (2026-10-03) - same as withTrans in lib/render.mjs, change both together:
   the later clip starts h = d/2 early (from its file's frames before s) and fades in over 2h on top of the earlier one, which
   runs h past its end. h is cut short to what the files hold (a still image always has it). */
export const withTrans = (list: Layer[]): Layer[] => {
  const vis = list.filter((L) => L.kind !== 'audio'), out = new Map(list.map((L) => [L, { ...L }] as [Layer, Layer]));
  vis.forEach((B) => {
    if (!B.tin || !(B.tin.d > 0)) return;
    const A = vis.find((A) => A !== B && A.track === B.track && Math.abs(A.at + (A.e - A.s) - B.at) < 0.02);
    if (!A) return;
    const hA = A.kind === 'image' ? Infinity : A.dur ? A.dur - A.e : 0, hB = B.kind === 'image' ? Infinity : B.s;
    const h = Math.min(B.tin.d / 2, hA, hB, (A.e - A.s) / 2, (B.e - B.s) / 2);
    if (!(h >= 0.01)) return;
    const a = out.get(A)!, b = out.get(B)!;
    a.e += h;
    b.at -= h; b.s -= h; b.xin = 2 * h;
    if (b.keys) b.keys = b.keys.map((k) => ({ ...k, t: k.t + h }));
  });
  return list.map((L) => out.get(L)!);
};

export const LayersView: React.FC<{ scene: Scene; env: Env; fps: number }> = ({ scene, env, fps }) => {
  const list = withTrans(scene.layers || []).sort((a, b) => (a.kind === 'audio' ? 1 : 0) - (b.kind === 'audio' ? 1 : 0) || a.track - b.track || a.at - b.at);
  return (
    <>
      {list.map((L, i) => {
        const from = Math.round(L.at * fps), dur = Math.max(1, Math.round((L.e - L.s) * fps));
        const url = env.url(abs(scene.dir, L.src));
        if (L.kind === 'audio') {
          const g = Math.min(1, Math.pow(10, (L.vol || 0) / 20));
          return (
            <Sequence key={L.id || i} from={from} durationInFrames={dur} premountFor={fps}>
              <Audio src={url} startFrom={Math.round(L.s * fps)} volume={(f) => (L.mute ? 0 : g * fadeAt(L, f / fps))} />
            </Sequence>
          );
        }
        const b = L.box || { x: scene.window.x, y: scene.window.y, w: scene.window.w, h: scene.window.h };
        return (
          <Sequence key={L.id || i} from={from} durationInFrames={dur} premountFor={fps}>
            <LayerPic L={L} url={url} b={b} fps={fps} />
          </Sequence>
        );
      })}
    </>
  );
};

const LayerPic: React.FC<{ L: Layer; url: string; b: Box; fps: number }> = ({ L, url, b: b0, fps }) => {
  const b = boxAt(L, useCurrentFrame() / fps, b0);
  const st: React.CSSProperties = { position: 'absolute', left: b.x, top: b.y, width: b.w, height: b.h, objectFit: 'fill' };
  return (
    <FadeBox L={L} fps={fps}>
      {L.kind === 'image' ? <Img src={url} style={st} /> : <Video src={url} startFrom={Math.round(L.s * fps)} muted style={st} />}
    </FadeBox>
  );
};

const FadeBox: React.FC<{ L: Layer; fps: number; children: React.ReactNode }> = ({ L, fps, children }) => {
  const f = useCurrentFrame();                 // frame inside the Sequence
  const o = (L.opacity ?? 1) * fadeAt(L, f / fps);
  return <div style={{ position: 'absolute', inset: 0, opacity: o, filter: colorCss(L) }}>{children}</div>;
};

/* colour: brightness / contrast / saturation as 1 = unchanged (ffmpeg eq in the render uses the same numbers) */
export const colorCss = (L: Layer) => {
  const c = L.color;
  if (!c) return undefined;
  return [c.brightness != null && c.brightness !== 1 ? `brightness(${c.brightness})` : '',
          c.contrast != null && c.contrast !== 1 ? `contrast(${c.contrast})` : '',
          c.saturation != null && c.saturation !== 1 ? `saturate(${c.saturation})` : ''].filter(Boolean).join(' ') || undefined;
};
