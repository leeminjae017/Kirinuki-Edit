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
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encoder } from './encoder.mjs';
import { animLen } from './animlen.mjs';

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHUNK_SEC = 2;
const VERSION = 6;                         // bump when the graph or capture changes, or stale chunks come back from cache

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
  }));
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
    items.push(['c', c.text, c.kind, c.x, c.y, c.size, c.color, ph]);
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
  const graph = [
    `[0:v]${shift}[bg]`, `[1:v]fps=${fps},${shift}[w]`, ...g, `[2:v]${shift}[ov]`,
    `[bg][${wout}]overlay=${W.x}:${W.y}[b]`, `[b][ov]overlay=0:0,setpts=PTS-STARTPTS,format=nv12[v]`,
  ].join(';');
  return new Promise((ok, no) => {
    const p = spawn('ffmpeg', ['-y', '-v', 'error',
      '-ss', a.toFixed(4), '-i', path.join(dir, scene.body.bg || 'bg.mp4'),
      '-ss', a.toFixed(4), '-i', path.join(dir, scene.body.window),
      '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'png', '-i', '-',
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
    if (need.size) {
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

  // audio: measure the window audio and apply one fixed gain
  // loudness of the main part only; pieces from other files (outro) were levelled on their own in body
  const mainDur = body.mainDuration && body.mainDuration < scene.duration - 0.05 ? body.mainDuration : null;
  const [I, TP] = measure(path.join(dir, scene.body.window), mainDur);
  const gain = Math.min(TARGET_I - I, TARGET_TP - TP);
  const list = path.join(cache, 'chunks.txt');
  fs.writeFileSync(list, chunks.map((c) => `file '${path.basename(c.out)}'`).join('\n'));
  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  const r = spawnSync('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-i', path.join(dir, scene.body.window),
    '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-af', `volume=${gain.toFixed(2)}dB` + (mainDur ? `:enable='lt(t,${mainDur})'` : ''), '-c:a', 'aac', '-b:a', '192k',
    '-t', scene.duration.toFixed(3), '-movflags', '+faststart', path.resolve(outPath)], { stdio: 'inherit' });
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
