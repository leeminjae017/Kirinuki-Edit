// scene.json -> finished mp4.
//
// Split of work:
//   React (headless Chrome)  transparent overlay only - captions, images, chat cards, title, their animation
//   ffmpeg                   background + window (zoom, push, shake, mono) + overlay composite, H.264 (GPU when available), audio
// Decoding video inside Chrome (OffthreadVideo) measured 12s per frame; overlay-only capture is ~20 frames/s.
//
// 1. Bundle src/ once per source hash (.bundle/<key>, 40-80s).
// 2. Split the video into 2s chunks. Chunk key = captions/overlays/fx touching it + window pieces + bundle.
//    An unchanged key reuses cache/chunk_<key>.mkv, so editing one caption re-renders one or two chunks.
// 3. Capture only frames whose overlay differs (overlaySig); PNGs persist in cache/ov/<key>.png across runs.
//    Each chunk pipes its PNGs in order into ffmpeg; three chunks encode in parallel.
// 4. Join chunks with -c copy and add the window audio with one fixed gain to reach the loudness target (no filters).
import { bundle } from '@remotion/bundler';
import { ensureBrowser, openBrowser, renderFrames, selectComposition } from '@remotion/renderer';
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import { curvesVf } from './color.mjs';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encoder } from './encoder.mjs';
import { animLen } from './animlen.mjs';

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHUNK_SEC = 2;
const VERSION = 7;                         // bump when the graph or capture changes, or stale chunks come back from cache

let scene, dir, body, VENC;
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const md5 = (s) => crypto.createHash('md5').update(s).digest('hex').slice(0, 16);

export function hashDir(d) {
  const h = crypto.createHash('md5');
  const walk = (p) => fs.readdirSync(p, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).forEach((e) => {
    const f = path.join(p, e.name);
    if (e.isDirectory()) walk(f); else { h.update(e.name); h.update(fs.readFileSync(f)); }
  });
  walk(d);
  return h.digest('hex').slice(0, 16);
}

// ---------------------------------------------------------------- file server (Chrome fetches images and fonts)
export function serve() {
  const srv = http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://x').searchParams.get('p') || '');
    let st;
    try { st = fs.statSync(p); } catch { res.writeHead(404); return res.end(); }
    const type = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.mp4': 'video/mp4',
      '.otf': 'font/otf', '.ttf': 'font/ttf' }[path.extname(p).toLowerCase()] || 'application/octet-stream';
    const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
    const a = m && m[1] ? +m[1] : 0, b = m && m[2] ? +m[2] : st.size - 1;
    res.writeHead(m ? 206 : 200, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': b - a + 1,
      'Access-Control-Allow-Origin': '*', ...(m ? { 'Content-Range': `bytes ${a}-${b}/${st.size}` } : {}) });
    fs.createReadStream(p, { start: a, end: b }).pipe(res);
  });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok(srv)));
}

// ---------------------------------------------------------------- chunk keys
function chunkKey(i, a, b, bundleKey) {
  const hit = (s, e) => s < b && e > a;
  return md5(JSON.stringify({
    VERSION, i, a, b, bundleKey, bg: body.bg, pieces: body.pieces.filter(([, s, d]) => hit(s, s + d)),
    window: scene.window, face: scene.face, title: scene.title, style: scene.style, fps: scene.fps, w: scene.width, h: scene.height,
    captions: scene.captions.filter((c) => hit(c.s, c.e)), hide: (scene.hideCaptions || []).filter(([s, e]) => hit(s, e)),
    overlays: (scene.overlays || []).filter((o) => hit(o.s, o.e)),
    fx: (scene.fx || []).filter((f) => hit(f.s, f.e)),
    files: (scene.overlays || []).filter((o) => o.src && hit(o.s, o.e)).map((o) => {   // swapping an image file re-renders too
      const st = fs.statSync(path.isAbsolute(o.src) ? o.src : path.join(dir, o.src)); return [o.src, st.size, st.mtimeMs | 0];
    }),
    trans: (body.transitions || []).filter((t) => hit(t.at, t.at + t.d)),
    layers: visLayers(a, b).map((L) => {
      const st = fs.statSync(layerPath(L)); return [L, st.size, st.mtimeMs | 0];
    }),
  }));
}

/* ---------------------------------------------------------------- hand-laid extra tracks (dashboard user edit tab, 2026-10-02)
   Video / image clips on V2.. are composited here (window -> layers -> React overlay, so captions stay on top); audio clips on
   A2.. are mixed in finish(). Volume dB, fades and colour are what the user set on the clip - nothing else is applied. */
const layerPath = (L) => (path.isAbsolute(L.src) ? L.src : path.join(dir, L.src));
const layerLen = (L) => L.e - L.s;
/* transitions between extra clips on one track (2026-10-03): a picture clip with tin {type, d} whose track neighbour ends where
   it starts. dissolve / wipe / slide cross over: both run h = d/2 past the cut (cut short to what their files hold beyond the
   clip; a still image always has it) and the later one comes in over 2h on top (slide also pushes the earlier one out).
   black / white dip through that colour: the earlier one goes to it over the last h before the cut, the later one comes out
   of it over the first h - nothing runs past the cut. Lengths elsewhere do not move. Gives xin / xout {type, d} (d = how long
   the clip's own part of the transition lasts). Same as withTrans in src/parts/Layers.tsx - change both together. */
const DIP = { black: 'black', white: 'white' };
function withTrans(list) {
  const vis = list.filter((L) => L.kind !== 'audio'), out = new Map(list.map((L) => [L, { ...L }]));
  vis.forEach((B) => {
    if (!B.tin || !(B.tin.d > 0)) return;
    const A = vis.find((A) => A !== B && A.track === B.track && Math.abs(A.at + (A.e - A.s) - B.at) < 0.02);
    if (!A) return;
    const a = out.get(A), b = out.get(B), ty = B.tin.type || 'dissolve';
    if (DIP[ty]) {
      const h = Math.min(B.tin.d / 2, (A.e - A.s) / 2, (B.e - B.s) / 2);
      if (h >= 0.01) { a.xout = { type: ty, d: h }; b.xin = { type: ty, d: h }; }
      return;
    }
    const hA = A.kind === 'image' ? Infinity : A.dur ? A.dur - A.e : 0, hB = B.kind === 'image' ? Infinity : B.s;
    const h = Math.min(B.tin.d / 2, hA, hB, (A.e - A.s) / 2, (B.e - B.s) / 2);
    if (!(h >= 0.01)) return;
    a.e += h; a.xout = { type: ty, d: 2 * h };
    b.at -= h; b.s -= h; b.xin = { type: ty, d: 2 * h };
    if (b.keys) b.keys = b.keys.map((k) => ({ ...k, t: k.t + h }));
  });
  return list.map((L) => out.get(L));
}
let EFF = null, EFF_OF;
function visLayers(a, b) {
  if (!EFF || EFF_OF !== scene.layers) { EFF_OF = scene.layers; EFF = withTrans(scene.layers || []); }   // !EFF: an episode with no layers (undefined === undefined) crashed every render (#23)
  return EFF.filter((L) => L.kind !== 'audio' && L.at < b && L.at + layerLen(L) > a).sort((x, y) => x.track - y.track || x.at - y.at);
}
/* transitions between window pieces (lib/body.mjs patches, window size): laid over the window stream before the zoom / shake
   effects, so they move with it like the rest of the window */
function transGraph(a, b, firstInput) {
  const ins = [], g = [];
  let cur = 'w0';
  (body.transitions || []).filter((t) => t.at < b && t.at + t.d > a).forEach((t, j) => {
    const start = Math.max(a, t.at), end = Math.min(b, t.at + t.d);
    ins.push('-ss', (start - t.at).toFixed(4), '-t', (end - start + 0.1).toFixed(4), '-i', path.join(dir, 'cache', t.file));
    g.push(`[${firstInput + j}:v]setpts=PTS-STARTPTS+${start.toFixed(4)}/TB[tr${j}]`,
      `[${cur}][tr${j}]overlay=0:0:eof_action=pass:enable='between(t,${start.toFixed(4)},${end.toFixed(4)})'[tw${j}]`);
    cur = `tw${j}`;
  });
  g.push(`[${cur}]null[w]`);
  return { ins, g };
}
function layerGraph(a, b, firstInput, base) {
  const fps = scene.fps, ins = [], g = [];
  let cur = base;
  visLayers(a, b).forEach((L, j) => {
    const k = firstInput + j, start = Math.max(a, L.at), end = Math.min(b, L.at + layerLen(L)), Lend = L.at + layerLen(L);
    // wipe / slide are ffmpeg xfade against a transparent clip, which needs the clip from the transition's first frame:
    // a chunk that starts inside one reads from there (rb) and trims after
    const xi = L.xin && (L.xin.type === 'wipe' || L.xin.type === 'slide') && start < L.at + L.xin.d ? L.xin : null;
    const xo = L.xout && L.xout.type === 'slide' && end > Lend - L.xout.d ? L.xout : null;
    let rb = start;
    if (xi) rb = L.at;
    if (xo) rb = Math.max(L.at, Math.min(rb, Lend - L.xout.d));
    const dur = (xo ? Math.max(end, Lend) : end) - rb, off = L.s + (rb - L.at);   // a slide out reads to the clip's end (xfade needs it all)
    if (L.kind === 'image') ins.push('-loop', '1', '-framerate', String(fps), '-t', (dur + 0.1).toFixed(3), '-i', layerPath(L));
    else ins.push('-ss', off.toFixed(4), '-t', (dur + 0.1).toFixed(3), '-i', layerPath(L));
    const K = (L.keys || []).length ? L.keys : null, moving = K && K.length > 1;
    const B = K ? K[0] : L.box || scene.window, ev = (v) => Math.max(2, Math.round(v / 2) * 2);
    const c = L.color || {}, op = L.opacity ?? 1, br = c.brightness ?? 1;
    // a moving clip is scaled once to its largest box and placed per frame by perspective (overlay cannot take a picture
    // whose size changes - scale eval=frame keeps the first frame's size, tried 2026-10-03)
    const MW = moving ? ev(Math.max(...K.map((k) => k.w))) : ev(B.w), MH = moving ? ev(Math.max(...K.map((k) => k.h))) : ev(B.h);
    // crop: a part of the file (source px) - a main clip moved to an upper track keeps the edit's framing (2026-10-03)
    const f = [`fps=${fps}`, ...(L.crop ? [`crop=${Math.round(L.crop.w)}:${Math.round(L.crop.h)}:${Math.round(L.crop.x)}:${Math.round(L.crop.y)}`] : []), `scale=${MW}:${MH}`];
    if ((c.contrast ?? 1) !== 1 || (c.saturation ?? 1) !== 1) f.push(`eq=contrast=${(c.contrast ?? 1).toFixed(3)}:saturation=${(c.saturation ?? 1).toFixed(3)}`);
    f.push('format=rgba');
    if (br !== 1 || op !== 1) f.push(`colorchannelmixer=rr=${br.toFixed(3)}:gg=${br.toFixed(3)}:bb=${br.toFixed(3)}:aa=${op.toFixed(3)}`);
    const cv = curvesVf(L.color);                  // RGBW + curves (lib/color.mjs, 2026-10-03)
    if (cv) f.push(cv);
    let pre = '';                                  // [k:v] -> xfade chain (wipe / slide) -> the rest of f
    if (xi || xo) {
      const z = (d, n) => `color=c=black@0:s=${MW}x${MH}:r=${fps}:d=${d.toFixed(4)},format=yuva444p,settb=1/${fps}[z${n}${j}]`;
      const head = `[${k}:v]${f.join(',')},format=yuva444p,setpts=PTS-STARTPTS,settb=1/${fps}[s0${j}]`;
      const ch = [head];
      let last = `s0${j}`;
      if (xi) {
        ch.push(z(xi.d, 'i'), `[zi${j}][${last}]xfade=transition=${xi.type === 'wipe' ? 'wipeleft' : 'slideleft'}:duration=${xi.d.toFixed(4)}:offset=0[s1${j}]`);
        last = `s1${j}`;
      }
      if (xo) {
        ch.push(z(xo.d, 'o'), `[${last}][zo${j}]xfade=transition=slideleft:duration=${xo.d.toFixed(4)}:offset=${(Lend - xo.d - rb).toFixed(4)}[s2${j}]`);
        last = `s2${j}`;
      }
      g.push(...ch);
      pre = `[${last}]trim=start=${(start - rb).toFixed(4)},`;
      f.length = 0;
    }
    f.push(`setpts=PTS-STARTPTS+${start.toFixed(4)}/TB`);
    if (L.xin && L.xin.type === 'dissolve') f.push(`fade=t=in:st=${L.at.toFixed(4)}:d=${L.xin.d.toFixed(4)}:alpha=1`);
    // fade color= on packed rgba fades the alpha too (the clip went see-through instead of black, measured 2026-10-03) - yuva is right
    if ((L.xin && DIP[L.xin.type]) || (L.xout && DIP[L.xout.type])) f.push('format=yuva444p');
    if (L.xin && DIP[L.xin.type]) f.push(`fade=t=in:st=${L.at.toFixed(4)}:d=${L.xin.d.toFixed(4)}:color=${DIP[L.xin.type]}`);   // out of black / white
    if (L.xout && DIP[L.xout.type]) f.push(`fade=t=out:st=${(Lend - L.xout.d).toFixed(4)}:d=${L.xout.d.toFixed(4)}:color=${DIP[L.xout.type]}`);
    const x0 = L.xin && !DIP[L.xin.type] ? L.xin.d / 2 : 0;    // a crossing transition starts the clip early - its own fade-in starts at the cut
    if (L.fin) f.push(`fade=t=in:st=${(L.at + x0).toFixed(4)}:d=${L.fin.toFixed(3)}:alpha=1`);
    const x1 = L.xout && !DIP[L.xout.type] ? L.xout.d / 2 : 0;
    if (L.fout) f.push(`fade=t=out:st=${(Lend - x1 - L.fout).toFixed(4)}:d=${L.fout.toFixed(3)}:alpha=1`);
    // rotation about the box centre (2026-10-03): the frame grows to the rotated size, transparent corners
    const ra = (L.rot || 0) * Math.PI / 180;
    const RW = ra ? ev(Math.abs(MW * Math.cos(ra)) + Math.abs(MH * Math.sin(ra))) : MW, RH = ra ? ev(Math.abs(MW * Math.sin(ra)) + Math.abs(MH * Math.cos(ra))) : MH;
    if (ra) f.push('format=yuva444p', `rotate=${ra.toFixed(6)}:ow=${RW}:oh=${RH}:fillcolor=none`);
    let ox = ra ? Math.round(B.x + B.w / 2 - RW / 2) : Math.round(B.x), oy = ra ? Math.round(B.y + B.h / 2 - RH / 2) : Math.round(B.y);
    if (moving) {
      // perspective counts its own input frames (in) from this chunk's first frame of the clip
      const T = `(${(start - L.at).toFixed(4)}+in/${fps})`, PW = Math.max(scene.width, RW + 4), PH = Math.max(scene.height, RH + 4);
      const seg = (key) => {                       // piecewise linear (or smoothstep) in T, held outside the keys
        const lin = (i) => {
          const a = K[i], b = K[i + 1], d = Math.max(1e-6, b.t - a.t);
          const p = `clip((${T}-${a.t.toFixed(4)})/${d.toFixed(4)},0,1)`, q = L.ease ? `(${p}*${p}*(3-2*${p}))` : p;
          return `(${a[key].toFixed(2)}+${(b[key] - a[key]).toFixed(2)}*${q})`;
        };
        let e = lin(K.length - 2);
        for (let i = K.length - 3; i >= 0; i--) e = `if(lt(${T},${K[i + 1].t.toFixed(4)}),${lin(i)},${e})`;
        return e;
      };
      const SX = `(${seg('w')}/${MW})`, SY = `(${seg('h')}/${MH})`, CX = `(${seg('x')}+${seg('w')}/2)`, CY = `(${seg('y')}+${seg('h')}/2)`;
      // the clip (RW x RH once rotated) sits at (2,2) inside a transparent pad; map the pad's corners so its centre lands on the box centre
      const x0 = `${CX}-${(2 + RW / 2).toFixed(2)}*${SX}`, x1 = `${CX}+${(PW - 2 - RW / 2).toFixed(2)}*${SX}`;
      const y0 = `${CY}-${(2 + RH / 2).toFixed(2)}*${SY}`, y1 = `${CY}+${(PH - 2 - RH / 2).toFixed(2)}*${SY}`;
      f.push('format=yuva444p', `pad=${PW}:${PH}:2:2:color=black@0`,
        `perspective=x0='${x0}':y0='${y0}':x1='${x1}':y1='${y0}':x2='${x0}':y2='${y1}':x3='${x1}':y3='${y1}':sense=destination:eval=frame`);
      ox = 0; oy = 0;
    }
    g.push(`${pre || `[${k}:v]`}${f.join(',')}[ly${j}]`,
      `[${cur}][ly${j}]overlay=${ox}:${oy}:eof_action=pass:enable='between(t,${start.toFixed(4)},${end.toFixed(4)})'[lb${j}]`);
    cur = `lb${j}`;
  });
  return { ins, g, out: cur };
}

function measure(file, limit = null) {
  const p = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, ...(limit ? ['-t', String(limit)] : []), '-af', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8' });
  const tail = p.stderr.split('Summary').pop();            // I: before Summary is a per-frame value
  return [+/I:\s*(-?[\d.]+) LUFS/.exec(tail)[1], +(/Peak:\s*(-?[\d.]+) dBFS/.exec(tail) || [0, -99])[1]];
}

// ---------------------------------------------------------------- window effects (ffmpeg)
// Same math as src/parts/Window.tsx (preview CSS) - change both together.
// Input [w] is the window-size video; t is output seconds (shifted by the chunk start with setpts).
function fxGraph(a, b) {
  const W = scene.window, face = scene.face || [W.x + W.w / 2, W.y + W.h / 2];
  const fl = [(face[0] - W.x) / W.w, (face[1] - W.y) / W.h];
  const on = (list) => list.map((f) => `between(t,${f.s.toFixed(3)},${f.e.toFixed(3)})`).join('+');
  const fx = (scene.fx || []).filter((f) => f.s < b && f.e > a);
  const g = [];
  let cur = 'w', n = 0;
  const nx = () => `x${n++}`;

  const zooms = {};
  fx.filter((f) => f.type === 'zoom').forEach((f) => (zooms[f.z] ||= []).push(f));
  for (const [zs, list] of Object.entries(zooms)) {                     // hard zoom around the face, kept inside the window
    const z = +zs, cw = Math.floor(W.w / z / 2) * 2, ch = Math.floor(W.h / z / 2) * 2;
    const cx = Math.round(Math.min(Math.max(face[0] - W.x - cw / 2, 0), W.w - cw));
    const cy = Math.round(Math.min(Math.max(face[1] - W.y - ch / 2, 0), W.h - ch));
    const s1 = nx(), s2 = nx(), c = nx(), o = nx();
    g.push(`[${cur}]split[${s1}][${s2}]`, `[${s2}]crop=${cw}:${ch}:${cx}:${cy},scale=${W.w}:${W.h}:flags=lanczos[${c}]`,
      `[${s1}][${c}]overlay=0:0:enable='${on(list)}'[${o}]`);
    cur = o;
  }
  for (const f of fx.filter((f) => f.type === 'push')) {                // slow push-in
    const u = `min(1,max(0,(t-${f.s.toFixed(3)})/${Math.max(0.01, f.e - f.s).toFixed(3)}))`;
    const z = `(${f.z0}+(${(f.z1 - f.z0).toFixed(4)})*${u})`;
    const s1 = nx(), s2 = nx(), sc = nx(), k = nx(), c = nx(), o = nx();
    g.push(`[${cur}]split[${s1}][${s2}]`, `[${s2}]scale=w='trunc(${W.w}*${z}/2)*2':h=-2:eval=frame[${sc}]`,
      `color=black:s=${W.w}x${W.h}:r=${scene.fps}[${k}]`,
      `[${k}][${sc}]overlay=x='-(overlay_w-${W.w})*${fl[0].toFixed(4)}':y='-(overlay_h-${W.h})*${fl[1].toFixed(4)}':eval=frame:shortest=1[${c}]`,
      `[${s1}][${c}]overlay=0:0:enable='${on([f])}'[${o}]`);
    cur = o;
  }
  const shakes = fx.filter((f) => f.type === 'shake');
  if (shakes.length) {                                                   // scale up slightly so edges never show while shaking
    const S = scene.style.effects?.shake || {}, amp = shakes[0].amp ?? S.amp ?? 12, hz = shakes[0].hz ?? S.hz ?? 14, Z = S.zoom ?? 1.06;
    const zw = Math.floor(W.w * Z / 2) * 2, zh = Math.floor(W.h * Z / 2) * 2, mx = (zw - W.w) / 2, my = (zh - W.h) / 2;
    const s1 = nx(), s2 = nx(), c = nx(), o = nx();
    g.push(`[${cur}]split[${s1}][${s2}]`,
      `[${s2}]scale=${zw}:${zh},crop=${W.w}:${W.h}:'${mx}+${Math.min(amp, mx)}*sin(2*PI*${hz}*t)':'${my}+${Math.min(amp, my)}*cos(2*PI*${hz}*t*1.3)'[${c}]`,
      `[${s1}][${c}]overlay=0:0:enable='${on(shakes)}'[${o}]`);
    cur = o;
  }
  for (const f of fx.filter((f) => f.type === 'blur')) {                 // gaussian blur (roleplay inserts)
    const o = nx(); g.push(`[${cur}]gblur=sigma=${f.sigma}:enable='${on([f])}'[${o}]`); cur = o;
  }
  const monos = fx.filter((f) => f.type === 'mono');
  if (monos.length) { const o = nx(); g.push(`[${cur}]hue=s=0:enable='${on(monos)}'[${o}]`); cur = o; }
  return { g, out: cur };
}

// ---------------------------------------------------------------- identical overlay frames
// The overlay is still on most frames (a caption only animates for its first 0.04-0.36s).
// Each frame gets a signature of what is visible and how far into its animation; equal signatures share one PNG.
// Must match the drawing rules in src/ - animation lengths come from the same preset.
function overlaySig(frame) {
  const t = frame / scene.fps, r4 = (v) => Math.round(v * 1e4) / 1e4;
  const on = (s, e) => t >= s && t < e;
  const items = [];
  const hidden = (scene.hideCaptions || []).some(([a, b]) => on(a, b));
  scene.captions.forEach((c) => {
    if (!on(c.s, c.e) || hidden) return;
    const K = scene.style.captions.kinds, a = (K[c.kind] || K[scene.style.captions.defaultKind]).anim;
    const ms = (t - c.s) * 1000, left = (c.e - t) * 1000;
    const len = animLen(a);
    const ph = ms < len ? r4(ms) : (a.type === 'fade' && a.outMs && left < a.outMs ? 'o' + r4(left) : '');
    items.push(['c', c.text, c.kind, c.x, c.y, c.size, c.color, ph, c.tf]);
  });
  (scene.overlays || []).forEach((o) => {
    if (!on(o.s, o.e)) return;
    const el = t - o.s;
    const popping = o.type !== 'insert' && o.type !== 'bubble' && o.pop !== false && el < (scene.style.image?.popSec ?? 0.14);
    // a bouncing or spinning image moves every frame - leaving spin out froze the rotation in the video
    // (stills were right) because equal signatures share one PNG: 손질 2026-09-25, 가위 · 칼 회전
    const spinning = o.spin && t >= o.spin.s ? r4((t - o.spin.s) % o.spin.period) : '';
    items.push([o, popping ? r4(el) : '', o.bounce ? r4(t % o.bounce.period) : '', spinning]);
  });
  if (scene.title && on(scene.title.s ?? 0, scene.title.e ?? scene.duration + 1)) items.push(['t', scene.title.text]);
  return items;
}

function chunkFfmpegPipe(a, frames, pngs, out) {
  const W = scene.window, fps = scene.fps;
  const { g, out: wout } = fxGraph(a, a + frames / fps);
  const shift = `setpts=PTS-STARTPTS+${a.toFixed(4)}/TB`;
  const LG = layerGraph(a, a + frames / fps, 3, 'b');
  const TG = transGraph(a, a + frames / fps, 3 + LG.ins.filter((x) => x === '-i').length);
  const graph = [
    `[0:v]${shift}[bg]`, `[1:v]fps=${fps},${shift}[w0]`, ...TG.g, ...g, `[2:v]${shift}[ov]`,
    `[bg][${wout}]overlay=${W.x}:${W.y}[b]`, ...LG.g, `[${LG.out}][ov]overlay=0:0,setpts=PTS-STARTPTS,format=nv12[v]`,
  ].join(';');
  return new Promise((ok, no) => {
    const p = spawn('ffmpeg', ['-y', '-v', 'error',
      '-ss', a.toFixed(4), '-i', path.join(dir, scene.body.bg || 'bg.mp4'),
      '-ss', a.toFixed(4), '-i', path.join(dir, scene.body.window),
      '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'png', '-i', '-', ...LG.ins, ...TG.ins,
      '-filter_complex', graph, '-map', '[v]', '-frames:v', String(frames), ...VENC, '-an', out + '.tmp.mkv'],
    { stdio: ['pipe', 'inherit', 'inherit'] });
    p.on('close', (code) => (code ? no(new Error('ffmpeg ' + code)) : (fs.renameSync(out + '.tmp.mkv', out), ok())));
    p.stdin.on('error', () => {});
    (async () => {
      for (const b of pngs) if (!p.stdin.write(b)) await new Promise((r) => p.stdin.once('drain', r));
      p.stdin.end();
    })();
  });
}

export async function renderScene(scenePath, outPath) {
  const sceneAbs = path.resolve(scenePath);
  dir = path.dirname(sceneAbs);
  scene = JSON.parse(fs.readFileSync(sceneAbs, 'utf8'));
  scene.dir = dir.split(path.sep).join('/');
  body = JSON.parse(fs.readFileSync(path.join(dir, 'body.json'), 'utf8'));
  VENC = encoder().args;
  const TARGET_I = scene.style.audio?.targetLufs ?? -16, TARGET_TP = scene.style.audio?.maxTruePeakDb ?? -1.5;
  const { bundleKey, bundleDir } = await ensureBundle();
  const cache = path.join(dir, 'cache'), ovDir = path.join(cache, 'ov');
  fs.mkdirSync(ovDir, { recursive: true });
  const fps = scene.fps, total = Math.round(scene.duration * fps), per = CHUNK_SEC * fps;

  const chunks = [];
  for (let i = 0, f = 0; f < total; i++, f += per) {
    const n = Math.min(per, total - f);
    chunks.push({ i, f, n, out: path.join(cache, `chunk_${chunkKey(i, f / fps, (f + n) / fps, bundleKey)}.mkv`) });
  }
  // Nothing drawn over the window and the window is the whole frame (a dance short without captions): the 2s chunks would
  // only re-encode window.mkv. Copy its picture instead - measured 허니하트 23s: render 28s -> a few s, and no second
  // generation of encoding loss. Checked on the real overlay: one image for every frame, fully transparent.
  const W = scene.window;
  if (W.x === 0 && W.y === 0 && W.w === scene.width && W.h === scene.height && !fxGraph(0, scene.duration).g.length && !visLayers(0, scene.duration).length && !(body.transitions || []).length) {
    const sig0 = JSON.stringify(overlaySig(0));
    let same = true;
    for (let f = 1; f < total && same; f++) same = JSON.stringify(overlaySig(f)) === sig0;
    if (same) {
      const k = md5(JSON.stringify([bundleKey, scene.width, scene.height, overlaySig(0)]));
      const png = path.join(ovDir, k + '.png');
      if (!fs.existsSync(png)) await capture(new Map([[k, 0]]), ovDir, bundleDir);
      const a = spawnSync('ffmpeg', ['-v', 'info', '-i', png, '-vf', 'alphaextract,signalstats,metadata=print:key=lavfi.signalstats.YMAX',
        '-f', 'null', '-'], { encoding: 'utf8' });
      if (/YMAX=0(\.0+)?\s/.test(a.stderr + '\n')) {
        log('overlay empty, window fills the frame: picture copied from window.mkv');
        return finish([`file '../${scene.body.window}'`], cache, outPath, ovDir, TARGET_I, TARGET_TP);
      }
    }
  }
  const dirty = chunks.filter((c) => !fs.existsSync(c.out));
  chunks.filter((c) => !dirty.includes(c)).forEach((c) => fs.utimesSync(c.out, new Date(), new Date()));

  if (dirty.length) {
    // 1) overlay key per frame of dirty chunks; capture each key once (skip if cached)
    const frameKey = new Map(), need = new Map();
    for (const c of dirty) for (let f = c.f; f < c.f + c.n; f++) {
      const k = md5(JSON.stringify([bundleKey, scene.width, scene.height, overlaySig(f)]));
      frameKey.set(f, k);
      if (!need.has(k) && !fs.existsSync(path.join(ovDir, k + '.png'))) need.set(k, f);
    }
    log(`overlay: ${need.size} new images for ${frameKey.size} frames`);
    if (need.size) await capture(need, ovDir, bundleDir);
    // 2) pipe each chunk's PNGs to ffmpeg in order (hard links fail on exFAT drives); GPU encoders take several sessions
    const png = new Map();
    const read = (k) => { if (!png.has(k)) png.set(k, fs.readFileSync(path.join(ovDir, k + '.png'))); return png.get(k); };
    const work = [...dirty];
    const worker = async () => {
      for (let c; (c = work.shift());) {
        const bufs = [];
        for (let f = c.f; f < c.f + c.n; f++) bufs.push(read(frameKey.get(f)));
        await chunkFfmpegPipe(c.f / fps, c.n, bufs, c.out);
        if (process.env.DEBUG) log(`chunk ${c.i} done`);
      }
    };
    await Promise.all([worker(), worker(), worker()]);
  }
  log(`chunks: ${dirty.length}/${chunks.length} rendered`);
  await finish(chunks.map((c) => `file '${path.basename(c.out)}'`), cache, outPath, ovDir, TARGET_I, TARGET_TP);
}

/* Capture the overlay frames in need (key -> frame) to ovDir/<key>.png */
async function capture(need, ovDir, bundleDir) {
  const srv = await serve();
  const frameMap = [...need.values()], keys = [...need.keys()];
  const inputProps = { scene, urlBase: `http://127.0.0.1:${srv.address().port}/f?p=`, overlay: true, frameMap };
  const browser = await openBrowser('chrome', { browserExecutable: await chrome() });
  const composition = await selectComposition({ serveUrl: bundleDir, id: 'Short', inputProps, puppeteerInstance: browser });
  await renderFrames({
    serveUrl: bundleDir, composition, inputProps, puppeteerInstance: browser,
    imageFormat: 'png', concurrency: Math.max(2, Math.floor(os.cpus().length / 2)), outputDir: null, onStart: () => {},
    onFrameUpdate: () => {},
    onFrameBuffer: (buf, i) => fs.writeFileSync(path.join(ovDir, keys[i] + '.png'), buf),
  });
  await browser.close({ silent: true });
  srv.close();
  log('overlay captured');
}

/* Join the chunk list (concat lines) and add the window audio with one fixed gain; drop chunks / overlays unused for 7 days */
async function finish(lines, cache, outPath, ovDir, TARGET_I, TARGET_TP) {
  // audio: measure the window audio and apply one fixed gain
  // loudness of the main part only; pieces from other files (outro) were levelled on their own in body
  const mainDur = body.mainDuration && body.mainDuration < scene.duration - 0.05 ? body.mainDuration : null;
  const [I, TP] = measure(path.join(dir, scene.body.window), mainDur);
  const gain = Math.min(TARGET_I - I, TARGET_TP - TP);
  const list = path.join(cache, 'chunks.txt');
  fs.writeFileSync(list, lines.join('\n'));
  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  const wa = `volume=${gain.toFixed(2)}dB` + (mainDur ? `:enable='lt(t,${mainDur})'` : '');
  // extra audio tracks (A2..): each at its own dB with its fades, delayed to its place, summed with the window (no normalising)
  const aud = (scene.layers || []).filter((L) => L.kind === 'audio' && !L.mute && L.at < scene.duration && layerLen(L) > 0.01);
  const ain = [], fc = [`[1:a]aresample=48000,aformat=channel_layouts=stereo,${wa}[m]`];
  aud.forEach((L, j) => {
    const len = layerLen(L), f = ['aresample=48000', 'aformat=channel_layouts=stereo'];
    if (L.vol) f.push(`volume=${L.vol.toFixed(2)}dB`);
    if (L.fin) f.push(`afade=t=in:st=0:d=${L.fin.toFixed(3)}`);
    if (L.fout) f.push(`afade=t=out:st=${Math.max(0, len - L.fout).toFixed(3)}:d=${L.fout.toFixed(3)}`);
    f.push(`adelay=${Math.round(L.at * 1000)}:all=1`);
    ain.push('-ss', L.s.toFixed(4), '-t', len.toFixed(4), '-i', layerPath(L));
    fc.push(`[${2 + j}:a]${f.join(',')}[x${j}]`);
  });
  if (aud.length) fc.push(`[m]${aud.map((_, j) => `[x${j}]`).join('')}amix=inputs=${aud.length + 1}:normalize=0:duration=first[aout]`);
  const r = spawnSync('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-i', path.join(dir, scene.body.window), ...ain,
    '-map', '0:v', ...(aud.length ? ['-filter_complex', fc.join(';'), '-map', '[aout]'] : ['-map', '1:a', '-af', wa]), '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
    '-t', scene.duration.toFixed(3), '-movflags', '+faststart', path.resolve(outPath)], { stdio: 'inherit' });
  if (aud.length) log(`mixed ${aud.length} extra audio clip(s)`);
  if (r.status) process.exit(1);
  log(`audio ${I.toFixed(1)} LUFS / peak ${TP.toFixed(1)} dB -> gain ${gain >= 0 ? '+' : ''}${gain.toFixed(1)} dB`);
  log('done:', outPath);

  const old = Date.now() - 7 * 86400e3;
  for (const d of [cache, ovDir]) for (const n of fs.readdirSync(d)) {
    const p = path.join(d, n);
    if (/^chunk_|\.png$/.test(n) && fs.statSync(p).mtimeMs < old) fs.rmSync(p);
  }
}


/* Remotion puts Chrome Headless Shell under node_modules/.remotion of the package that holds process.cwd(), so a
   render started from an episode folder downloaded its own 521MB copy there. Resolve it once from the shortsmith
   package and pass the path to every Remotion call. */
let chromePath;
export async function chrome() {
  if (!chromePath) {
    const cwd = process.cwd();
    process.chdir(HERE);
    try { chromePath = (await ensureBrowser()).path; } finally { process.chdir(cwd); }
  }
  return chromePath;
}

export async function ensureBundle() {
  const bundleKey = hashDir(path.join(HERE, 'src'));
  const bundleDir = path.join(HERE, '.bundle', bundleKey);
  if (!fs.existsSync(path.join(bundleDir, 'index.html'))) {
    log('bundling (src changed)');
    await bundle({ entryPoint: path.join(HERE, 'src/index.ts'), outDir: bundleDir });
  }
  return { bundleKey, bundleDir };
}

/* One frame with the full picture drawn in Chrome (background and window included) - for checking a design. */
export async function still(scenePath, sec, out) {
  const { renderStill } = await import('@remotion/renderer');
  const sc = JSON.parse(fs.readFileSync(scenePath, 'utf8'));
  sc.dir = path.dirname(path.resolve(scenePath)).split(path.sep).join('/');
  const { bundleDir } = await ensureBundle();
  const srv = await serve();
  const inputProps = { scene: sc, urlBase: `http://127.0.0.1:${srv.address().port}/f?p=` };
  const browserExecutable = await chrome();
  const composition = await selectComposition({ serveUrl: bundleDir, id: 'Short', inputProps, browserExecutable });
  await renderStill({ serveUrl: bundleDir, composition, inputProps, browserExecutable, frame: Math.round(sec * sc.fps), output: path.resolve(out) });
  srv.close();
}
