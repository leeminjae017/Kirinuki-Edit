import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { Env, Scene, on } from './scene';
import { useFonts } from './fonts';
import { Background, WindowView } from './parts/Window';
import { CaptionView, TitleView } from './parts/Caption';
import { BubbleView, ChatView, ImageView, InsertView } from './parts/Overlays';

/* One short. Layers bottom to top: background > window > images > chat cards > captions > title.
   Everything is a pure function of the frame number, so any frame range renders identically on its own.
   frameMap: the renderer captures only frames whose overlay differs; entry n is the real frame number. */
export type ShortProps = { scene: Scene; env: Env; layers?: { body?: boolean }; frameMap?: number[] };

export const Short: React.FC<ShortProps> = ({ scene, env, layers, frameMap }) => {
  const fonts = useFonts(scene.style, env.url);
  const cf = useCurrentFrame();
  const frame = frameMap ? frameMap[cf] ?? cf : cf;
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const body = layers?.body !== false;
  return (
    <AbsoluteFill style={{ background: body ? '#000' : 'transparent', overflow: 'hidden' }}>
      {body && <Background scene={scene} env={env} />}
      {body && <WindowView scene={scene} env={env} t={t} />}
      {fonts && (scene.overlays || []).filter((o) => o.type === 'image' && on(t, o.s, o.e)).map((o, i) =>
        <ImageView key={'i' + i} o={o as any} scene={scene} env={env} t={t} />)}
      {fonts && (scene.overlays || []).filter((o) => o.type === 'chat' && on(t, o.s, o.e)).map((o, i) =>
        <ChatView key={'c' + i} o={o as any} scene={scene} env={env} t={t} />)}
      {(scene.overlays || []).filter((o) => o.type === 'insert' && on(t, o.s, o.e)).map((o, i) =>
        <InsertView key={'n' + i} o={o as any} scene={scene} env={env} />)}
      {(scene.overlays || []).filter((o) => o.type === 'bubble' && on(t, o.s, o.e)).map((o, i) =>
        <BubbleView key={'b' + i} o={o as any} scene={scene} />)}
      {fonts && <svg width={scene.width} height={scene.height} style={{ position: 'absolute', inset: 0 }}>
        {scene.captions.filter((c) => on(t, c.s, c.e) && !(scene.hideCaptions || []).some(([a, b]) => on(t, a, b))).map((c, i) => <CaptionView key={c.id || i} uid={'cap' + (c.id || i)} c={c} t={t} style={scene.style} width={scene.width} />)}
        {scene.title && on(t, scene.title.s ?? 0, scene.title.e ?? scene.duration + 1) && <TitleView text={scene.title.text} style={scene.style} width={scene.width} />}
      </svg>}
    </AbsoluteFill>
  );
};
