/* Transition types (dashboard user edit tab). Render (ffmpeg xfade) and preview (CSS) read the same table.
   wipe / slide without a suffix go left (the first ones, kept for saved projects); _r _u _d = right, up, down. */
export const XFADE = {
  dissolve: 'fade', black: 'fadeblack', white: 'fadewhite',
  wipe: 'wipeleft', wipe_r: 'wiperight', wipe_u: 'wipeup', wipe_d: 'wipedown',
  slide: 'slideleft', slide_r: 'slideright', slide_u: 'slideup', slide_d: 'slidedown',
  circle: 'circleopen',
};
export const isWipe = (t) => /^wipe/.test(t || '');
export const isSlide = (t) => /^slide/.test(t || '');
/* uses xfade against a transparent clip on an upper track (render.mjs layerGraph) */
export const isXf = (t) => isWipe(t) || isSlide(t) || t === 'circle';
const dir = (t) => (/_([rud])$/.exec(t || '') || [0, 'l'])[1];

/* incoming picture at progress p (0..1): clip-path and offset in box units (w, h). Measured against ffmpeg xfade
   (2026-10-03, red -> blue at p = 0.25): wipeleft shows the new picture on the right, slideright brings it from the left */
export function transIn(t, p, w, h) {
  const q = ((1 - p) * 100).toFixed(2) + '%';
  if (isWipe(t)) return { clip: { l: `inset(0 0 0 ${q})`, r: `inset(0 ${q} 0 0)`, u: `inset(${q} 0 0 0)`, d: `inset(0 0 ${q} 0)` }[dir(t)], dx: 0, dy: 0 };
  if (isSlide(t)) {
    const d = dir(t), k = 1 - p;
    return { clip: undefined, dx: d === 'l' ? k * w : d === 'r' ? -k * w : 0, dy: d === 'u' ? k * h : d === 'd' ? -k * h : 0 };
  }
  // circleopen: nothing until ~0.15, the corners by ~0.75 (measured)
  if (t === 'circle') return { clip: `circle(${(Math.min(1, Math.max(0, (p - 0.15) / 0.6)) * 71).toFixed(2)}% at 50% 50%)`, dx: 0, dy: 0 };
  return { clip: undefined, dx: 0, dy: 0 };
}
/* outgoing picture of a slide (pushed out the same way) */
export function transOut(t, p, w, h) {
  if (!isSlide(t)) return { dx: 0, dy: 0 };
  const d = dir(t);
  return { dx: d === 'l' ? -p * w : d === 'r' ? p * w : 0, dy: d === 'u' ? -p * h : d === 'd' ? p * h : 0 };
}
