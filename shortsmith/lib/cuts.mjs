import { spawnSync } from 'node:child_process';

/* Waveform-only cut boundaries (ported from the per-project audio.py, 2026-09-17).

   Transcript word times are not used for cut points: on one source Whisper put word ends ~0.3s early and every
   boundary built on them clipped the last syllable. Two rules decide everything:
     1. a piece never starts or ends while a sound is still going
     2. silence inside a piece never lasts mergeGapSec or longer
   Level detection is hysteretic: a sound must reach thresholdHi to count and keeps going while above thresholdLo.
   A single flat threshold drops the quiet tail of a falling syllable.

   `keep` ranges (source seconds) come from the editor (human or AI reading the transcript). This module only moves
   their edges to quiet points and removes dead air inside them. */

const SR = 16000;

export function analyze(file, cut) {
  const frame = cut.frameSec ?? 0.01;
  const af = ['-ac', '1', '-ar', String(SR)];
  // levelFilter is for measuring only (e.g. band-limit a music bed); it never reaches the output
  if (cut.levelFilter) af.unshift('-af', cut.levelFilter);
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-vn', ...af, '-f', 'f32le', '-'], { maxBuffer: 2 ** 31 });
  if (r.status !== 0) throw new Error('could not decode audio: ' + r.stderr);
  const a = new Float32Array(r.stdout.buffer, r.stdout.byteOffset, Math.floor(r.stdout.byteLength / 4));
  const h = Math.round(frame * SR), n = Math.floor(a.length / h);
  const rms = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = i * h; j < (i + 1) * h; j++) s += a[j] * a[j];
    rms[i] = Math.sqrt(s / h);
  }
  const sm = new Float32Array(n);                      // 3-frame median (wraps at the ends like np.roll)
  for (let i = 0; i < n; i++) {
    const v = [rms[(i - 1 + n) % n], rms[i], rms[(i + 1) % n]].sort((x, y) => x - y);
    sm[i] = v[1];
  }
  return makeLevel(sm, frame, cut);
}

export function makeLevel(sm, frame, cut) {
  const n = sm.length, HI = cut.thresholdHi, LO = cut.thresholdLo;
  const runs = [];
  for (let i = 0; i < n;) {
    if (sm[i] > HI) {
      let j = i; while (j > 0 && sm[j - 1] > LO) j--;
      let k = i; while (k < n - 1 && sm[k + 1] > LO) k++;
      if (runs.length && j <= runs[runs.length - 1][1]) runs[runs.length - 1][1] = k; else runs.push([j, k]);
      i = k + 1;
    } else i++;
  }
  const sounds = runs.map(([a, b]) => [a * frame, (b + 1) * frame]);
  return { sm, n, frame, dur: n * frame, sounds, cut };
}

const r3 = (v) => Math.round(v * 1000) / 1000;
const inSound = (L, t) => L.sounds.some(([a, b]) => a < t && t < b);

function phrases(L, s, e, join) {
  const rs = L.sounds.filter(([a, b]) => b > s && a < e).map(([a, b]) => [Math.max(a, s), Math.min(b, e)]);
  if (!rs.length) return [];
  const out = [rs[0].slice()];
  for (const [a, b] of rs.slice(1)) {
    if (a - out[out.length - 1][1] < join) out[out.length - 1][1] = b; else out.push([a, b]);
  }
  return out.filter(([a, b]) => b - a >= (L.cut.minRunSec ?? 0.06));
}

/* Nearest instant within `reach` where a boundary will not cut a word: the middle of a real gap if there is one,
   else the first frame under thresholdHi, else the quietest frame (a syllable joint). */
export function quietPoint(L, t, dir, reach) {
  if (!inSound(L, t)) return t;
  const { sm, n, frame } = L, HI = L.cut.thresholdHi, LO = L.cut.thresholdLo;
  const i0 = Math.floor(t / frame), span = Math.floor(reach / frame);
  let best = null;
  for (let s = 0; s < span; s++) {
    const j = i0 + dir * s;
    if (j < 0 || j >= n) break;
    if (sm[j] <= LO) {
      let k = j;
      while (k + dir >= 0 && k + dir < n && sm[k + dir] <= LO) k += dir;
      const [a, b] = j < k ? [j, k] : [k, j];
      return r3((a + b + 1) / 2 * frame);
    }
    if (sm[j] <= HI) return r3(j * frame);
    if (!best || sm[j] < best[0]) best = [sm[j], j];
  }
  return best ? r3(best[1] * frame) : t;
}

function air(L, t, dir) {
  const pad = L.cut.padSec ?? 0.08, i = Math.floor(t / L.frame);
  let k = 0;
  while (k * L.frame < pad) {
    const j = i + dir * (k + 1);
    if (j < 0 || j >= L.n || L.sm[j] > L.cut.thresholdLo) break;
    k++;
  }
  return Math.max(0, Math.min(L.dur, t + dir * k * L.frame));
}

/* Speech-bounded pieces covering one keep range [s,e], dead air removed.
   trim: sub-ranges to drop. join / merge: per-range overrides for slow words whose stop closures read as pauses. */
export function pieces(L, s, e, { trim = [], join, merge } = {}) {
  const C = L.cut;
  join = join ?? C.joinGapSec ?? 0.12;
  merge = merge ?? C.mergeGapSec ?? 0.2;
  let s2 = s, e2 = e;
  if (inSound(L, s)) { const back = quietPoint(L, s, -1, C.headReachSec ?? 0.4); s2 = back !== s ? back : quietPoint(L, s, +1, C.headReachSec ?? 0.4); }
  if (inSound(L, e)) { const fwd = quietPoint(L, e, +1, C.footReachSec ?? 0.6); e2 = fwd !== e ? fwd : quietPoint(L, e, -1, 0.4); }
  if (e2 <= s2) return [];
  let ph = phrases(L, s2, e2, join);
  if (!ph.length) return [[r3(s2), r3(e2)]];
  for (const [ta, tb] of trim) {
    const cut = [];
    for (const [a, b] of ph) {
      if (b <= ta || a >= tb) { cut.push([a, b]); continue; }
      if (a < ta) cut.push([a, ta]);
      if (b > tb) cut.push([tb, b]);
    }
    ph = cut.filter(([a, b]) => b - a >= 0.12);
  }
  const out = [];
  let prevEnd = null;
  for (const [a, b] of ph) {
    const a2 = air(L, Math.max(s2, a), -1), b2 = air(L, Math.min(e2, b), +1);
    if (out.length && a - prevEnd < merge) out[out.length - 1][1] = b2; else out.push([a2, b2]);
    prevEnd = b;
  }
  return out.filter(([a, b]) => b - a >= (C.minPieceSec ?? 0.2)).map(([a, b]) => [r3(a), r3(b)]);
}

/* edit.keep entries: [s, e] or { s, e, gainDb, trim, join, merge, crop, source, raw } or { gap }. Default: the whole source.
   crop: this piece's own crop (framing per scene). source: another file (e.g. an outro), taken raw.
   gap: seconds of empty window (black picture, silence) - a cut left open instead of closed (ripple off in the
   dashboard, 2026-09-30). Its piece is { gap: true, s: 0, e: seconds } and never matches a source time. */
export function planCuts(L, keep) {
  const list = (keep && keep.length ? keep : [[0, L.dur]]).map((k) => (Array.isArray(k) ? { s: k[0], e: k[1] } : k));
  const out = [];
  list.forEach((k, group) => {
    if (k.gap) { out.push({ s: 0, e: +k.gap, gap: true, group }); return; }
    // color: { brightness, contrast, saturation } (1 = unchanged), tin: { type, d } transition into this piece from the one before -
    // both set on a clip in the dashboard user edit tab (2026-10-02)
    const extra = { ...(k.gainDb ? { gainDb: k.gainDb } : {}), ...(k.crop ? { crop: k.crop } : {}), ...(k.source ? { source: k.source } : {}),
      ...(k.color ? { color: k.color } : {}), ...(k.tin ? { tin: k.tin } : {}), ...(k.tf ? { tf: k.tf } : {}), ...(k.vhide ? { vhide: true } : {}), ...(k.ahide ? { ahide: true } : {}) };
    // raw: taken as is (an outro file, or a stretch where the waveform must not decide). Other sources are always raw
    if (k.raw || k.source) { out.push({ s: k.s, e: k.e, group, raw: true, ...extra }); return; }
    for (const [s, e] of pieces(L, k.s, k.e, k)) out.push({ s, e, group, ...extra });
  });
  // keep ranges that touch would put the same sound in twice (heard as a repeat): trim the later piece
  for (let i = 1; i < out.length; i++) {
    const p = out[i - 1], q = out[i];
    if (!p.source && !q.source && !p.gap && !q.gap && q.s < p.e && q.e > p.s && q.s >= p.s) q.s = p.e;
  }
  return out.filter((p) => p.e - p.s > 0.05);
}

