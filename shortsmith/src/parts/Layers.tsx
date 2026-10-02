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
  if (L.fin && t < L.fin) k = Math.min(k, Math.max(0, t / L.fin));
  if (L.fout && t > len - L.fout) k = Math.min(k, Math.max(0, (len - t) / L.fout));
  return k;
};

export const LayersView: React.FC<{ scene: Scene; env: Env; fps: number }> = ({ scene, env, fps }) => {
  const list = (scene.layers || []).slice().sort((a, b) => (a.kind === 'audio' ? 1 : 0) - (b.kind === 'audio' ? 1 : 0) || a.track - b.track);
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

const LayerPic: React.FC<{ L: Layer; url: string; b: { x: number; y: number; w: number; h: number }; fps: number }> = ({ L, url, b, fps }) => {
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
