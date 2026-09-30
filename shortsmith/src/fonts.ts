import { useEffect, useState } from 'react';
import { continueRender, delayRender } from 'remotion';
import type { FontDef, Preset } from './preset';

/* Fonts load from their files (headless Chrome may not see per-user font folders).
   Nothing is drawn and no frame is captured until they load: text is measured to fit, and a
   measurement taken with a fallback font would stick. */
const loading = new Map<string, Promise<void>>();
const done = new Set<string>();

function load(style: Preset, url: (abs: string) => string) {
  const key = style.id;
  if (!loading.has(key)) {
    loading.set(key, Promise.all(Object.values(style.fonts).map(async (f) => {
      if (!f.path) return;                              // not found on this machine: system fallback
      const face = new FontFace(f.family, `url("${url(f.path)}")`);
      await face.load();
      (document.fonts as any).add(face);
    })).then(() => { done.add(key); }).catch((e) => { console.error('font load', e); done.add(key); }));
  }
  return loading.get(key)!;
}

export function useFonts(style: Preset, url: (abs: string) => string) {
  const [ready, setReady] = useState(done.has(style.id));
  const [handle] = useState(() => (done.has(style.id) ? null : delayRender('fonts')));
  useEffect(() => {
    if (ready) { if (handle !== null) continueRender(handle); return; }
    let alive = true;
    load(style, url).then(() => alive && setReady(true));
    return () => { alive = false; };
  }, [ready, style.id]);
  return ready;
}

let ctx: CanvasRenderingContext2D | null = null;
function c2d() {
  if (!ctx) ctx = document.createElement('canvas').getContext('2d');
  return ctx!;
}

export function textWidth(text: string, family: string, cssPx: number) {
  const c = c2d();
  c.font = `${cssPx}px "${family}"`;
  return c.measureText(text).width;
}

/* line box height (ASS size) -> CSS font-size ratio and ascent share. Preset values win; otherwise measured. */
export function metrics(f: FontDef) {
  if (f.lineToEm && f.ascent) return { lineToEm: f.lineToEm, ascent: f.ascent };
  const c = c2d();
  c.font = `100px "${f.family}"`;
  const m = c.measureText('Hg가');
  const a = m.fontBoundingBoxAscent || 80, d = m.fontBoundingBoxDescent || 20;
  return { lineToEm: f.lineToEm ?? 100 / (a + d), ascent: f.ascent ?? a / (a + d) };
}
