import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const t0 = Date.now();
export const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
export const md5 = (s) => crypto.createHash('md5').update(typeof s === 'string' ? s : JSON.stringify(s)).digest('hex').slice(0, 16);
export const sig = (p) => { const st = fs.statSync(p); return `${st.size}:${Math.floor(st.mtimeMs)}`; };
export const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
export const writeJson = (p, v) => fs.writeFileSync(p, JSON.stringify(v, null, 1));
export const slash = (p) => p.split(path.sep).join('/');
export const resolveFrom = (dir, p) => (p == null ? p : path.isAbsolute(p) ? p : path.join(dir, p));

export function run(cmd, args, what, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 28, ...opts });
  if (r.status !== 0) {
    process.stderr.write((r.stderr || '').slice(-2000));
    throw new Error(`failed: ${what}`);
  }
  return r;
}

export function duration(file) {
  const r = run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], 'probe ' + file);
  return parseFloat(r.stdout.trim());
}

/* Integrated loudness and true-ish peak (ebur128). Read only after "Summary" - earlier lines carry per-frame I values. */
export function loudness(file, limit = null) {
  const p = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, ...(limit ? ['-t', String(limit)] : []), '-af', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8' });
  const tail = p.stderr.split('Summary').pop();
  const I = /I:\s*(-?[\d.]+) LUFS/.exec(tail), P = /Peak:\s*(-?[\d.]+) dBFS/.exec(tail);
  if (!I) throw new Error('could not measure loudness');
  return { I: +I[1], TP: P ? +P[1] : -99 };
}

export function spawnPromise(cmd, args, opts = {}) {
  const p = spawn(cmd, args, opts);
  const done = new Promise((ok, no) => p.on('close', (c) => (c ? no(new Error(`${cmd} exited ${c}`)) : ok())));
  return { p, done };
}

/* Output time for a source time, given cut pieces [{s,e}] in order. null when t was cut away. */
export function toOutput(pieces, t, speed = 1) {
  let acc = 0;
  for (const p of pieces) {
    if (!p.source && !p.gap && t >= p.s && t <= p.e) return (acc + (t - p.s)) / speed;   // pieces from other files · gaps never match
    acc += p.e - p.s;
  }
  return null;
}
