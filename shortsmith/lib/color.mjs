/* Colour of a clip beyond brightness / contrast / saturation (dashboard user edit tab, 2026-10-03: "색은 rgbw, 컬러 커브 그래프").
   c.lift / c.gamma / c.gain = { r, g, b, w } in UI units -100..100 (w = all three channels), c.curves = { m, r, g, b } point lists
   [[x, y], ...] in 0..1 (m = master, applied before the channel curve). Per channel, in this order:
     lift   v = x + L (1 - x),   L = (lift.c + lift.w) / 200       (raises / lowers the blacks, whites stay)
     gamma  v = v ^ 2^-G,       G = (gamma.c + gamma.w) / 100     (+ brightens the mids)
     gain   v = v (1 + K),      K = (gain.c + gain.w) / 100       (scales towards the whites)
     curves v = C_c(C_m(v))     monotone cubic (pchip) through the points
   The render bakes the whole thing into one ffmpeg `curves=interp=pchip` with 33 samples per channel; the preview uses the same
   samples in an SVG feComponentTransfer table. Same code in src/color.ts and dashboard/js/useredit.js (curve drawing) -
   change them together. */
const clamp = (v) => Math.max(0, Math.min(1, v));

export function pchip(points) {
  const P = (points || []).map(([x, y]) => [clamp(+x), clamp(+y)]).sort((a, b) => a[0] - b[0])
    .filter((p, i, A) => i === 0 || p[0] - A[i - 1][0] > 1e-4);
  if (!P.length) return (x) => x;
  if (P.length === 1) return () => P[0][1];
  const n = P.length, h = [], d = [], m = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) { h[i] = P[i + 1][0] - P[i][0]; d[i] = (P[i + 1][1] - P[i][1]) / h[i]; }
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) m[i] = 0;
    else { const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1]; m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]); }
  }
  return (x) => {
    if (x <= P[0][0]) return P[0][1];
    if (x >= P[n - 1][0]) return P[n - 1][1];
    let i = 0;
    while (i < n - 2 && x > P[i + 1][0]) i++;
    const t = (x - P[i][0]) / h[i], t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * P[i][1] + (t3 - 2 * t2 + t) * h[i] * m[i] + (-2 * t3 + 3 * t2) * P[i + 1][1] + (t3 - t2) * h[i] * m[i + 1];
  };
}

const isId = (pts) => !pts || !pts.length || pts.every(([x, y]) => Math.abs(x - y) < 1e-3);
export function hasTone(c) {
  if (!c) return false;
  const nz = (o) => o && ['r', 'g', 'b', 'w'].some((k) => Math.abs(o[k] || 0) > 1e-3);
  return !!(nz(c.lift) || nz(c.gamma) || nz(c.gain) || (c.curves && ['m', 'r', 'g', 'b'].some((k) => !isId(c.curves[k]))));
}

export function chanFn(c, ch) {
  const L = ((c.lift?.[ch] || 0) + (c.lift?.w || 0)) / 200, G = ((c.gamma?.[ch] || 0) + (c.gamma?.w || 0)) / 100;
  const K = ((c.gain?.[ch] || 0) + (c.gain?.w || 0)) / 100;
  const cm = pchip(isId(c.curves?.m) ? null : c.curves.m), cc = pchip(isId(c.curves?.[ch]) ? null : c.curves[ch]);
  const ex = Math.pow(2, -G);
  return (x) => clamp(cc(cm(clamp(Math.pow(clamp(x + L * (1 - x)), ex) * (1 + K)))));
}

export function toneTables(c, n = 33) {
  const out = {};
  for (const ch of ['r', 'g', 'b']) { const f = chanFn(c, ch); out[ch] = Array.from({ length: n }, (_, i) => +f(i / (n - 1)).toFixed(4)); }
  return out;
}

export function curvesVf(c) {
  if (!hasTone(c)) return '';
  const T = toneTables(c), pts = (a) => a.map((y, i) => `${(i / (a.length - 1)).toFixed(4)}/${y}`).join(' ');
  return `curves=interp=pchip:r='${pts(T.r)}':g='${pts(T.g)}':b='${pts(T.b)}'`;
}
