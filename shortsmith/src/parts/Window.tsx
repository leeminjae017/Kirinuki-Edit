import React from 'react';
import { AbsoluteFill, Img, OffthreadVideo, Sequence, Video, useCurrentFrame, useVideoConfig } from 'remotion';
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
  const layer: React.CSSProperties = { position: 'absolute', left: 0, top: 0, width: W.w, height: W.h, transformOrigin: '0 0' };
  const win = scene.body.windowPreview && env.preview ? scene.body.windowPreview : scene.body.window;

  return (
    <div style={{ position: 'absolute', left: W.x, top: W.y, width: W.w, height: W.h, overflow: 'hidden', filter: [mono ? 'grayscale(1)' : '', blur ? `blur(${blur.sigma}px)` : ''].join(' ').trim() || undefined }}>
      <div style={{ ...layer, transform: shakeT || undefined }}>
        <div style={{ ...layer, transform: pushT || undefined }}>
          <div style={{ ...layer, transform: transform || undefined }}>
            {env.preview && scene.plan
              ? <PlanWindow scene={scene} env={env} fps={fps} />
              : <Media src={abs(scene.dir, win)} env={env} style={{ width: W.w, height: W.h, display: 'block' }} />}
          </div>
        </div>
      </div>
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
  return (
    <>
      <div style={{ position: 'absolute', left: 0, top: 0, width: W.w, height: W.h, background: '#000' }} />
      {R.map((r, i) => {
        const from = Math.round(r.at * fps), len = Math.max(1, Math.round((r.e - r.s) * fps));
        const h0 = cutAt(i) ? Math.min(h, from, Math.round(r.s * fps)) : 0, h1 = cutAt(i + 1) ? h : 0;
        return (
          <Sequence key={i + ':' + r.s} from={from - h0} durationInFrames={len + h0 + h1} premountFor={Math.round(fps * 0.6)}>
            <PlanRange scene={scene} env={env} fps={fps} r={r} len={len} h0={h0} h1={h1} z={i} />
          </Sequence>
        );
      })}
    </>
  );
};

type PlanR = NonNullable<Scene['plan']>['ranges'][number];
const PlanRange: React.FC<{ scene: Scene; env: Env; fps: number; r: PlanR; len: number; h0: number; h1: number; z: number }> =
  ({ scene, env, fps, r, len, h0, h1, z }) => {
    const W = scene.window, P = scene.plan!, f = useCurrentFrame();
    const k = W.w / r.crop.w, v = r.vol ?? 1;
    const shown = f >= h0 && f < h0 + len;
    const vol = (x: number) => {
      if (h0 && x < 2 * h0) return v * clamp(x / (2 * h0), 0, 1);
      if (h1 && x > len + h0 - h1) return v * clamp((len + h0 + h1 - x) / (2 * h1), 0, 1);
      return v;
    };
    return (
      <div style={{ position: 'absolute', left: 0, top: 0, width: W.w, height: W.h, overflow: 'hidden', opacity: shown ? 1 : 0 }}>   {/* no zIndex - it lifted the video over the caption layer */}
        <Video src={env.url(abs(scene.dir, P.src))} startFrom={Math.round(r.s * fps) - h0} volume={vol}
          acceptableTimeShiftInSeconds={0.3}
          style={{ position: 'absolute', left: -r.crop.x * k, top: -r.crop.y * k, width: P.srcW * k, height: P.srcH * k, maxWidth: 'none' }} />
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
