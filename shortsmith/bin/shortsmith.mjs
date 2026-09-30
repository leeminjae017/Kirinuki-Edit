#!/usr/bin/env node
/* shortsmith - cut, caption and render vertical shorts from a long recording.

   A project is a folder with edit.json:
   {
     "preset": "basic-shorts",               preset id or path
     "source": "recording.mp4",
     "crop": { "x": 468, "y": 0, "w": 1024, "h": 1080 },
     "keep": [[12.3, 18.9], { "s": 30, "e": 41.2, "gainDb": 2, "trim": [[33, 33.4]] }],   source seconds, default: all
     "cut": { "thresholdLo": 0.011 },        per-source overrides of preset.cut
     "levelSource": "level.wav",             optional track used only to measure levels
     "captions": "captions.csv",             start,end,speaker,text
     "captionClock": "output",               "output" (default) or "source"
     "fx": "fx.json",
     "out": "out/short.mp4"
   }
   Commands run in order: cuts -> body -> scene -> render. `build` runs whatever is needed. */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { analyze, planCuts } from '../lib/cuts.mjs';
import { buildBody } from '../lib/body.mjs';
import { buildScene } from '../lib/scene.mjs';
import { renderScene, still } from '../lib/render.mjs';
import { listPresets, loadPreset } from '../lib/preset.mjs';
import { encoder } from '../lib/encoder.mjs';
import { log, readJson, toOutput, writeJson } from '../lib/util.mjs';

const [cmd = 'help', ...args] = process.argv.slice(2);
const flag = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args.splice(i, 2)[1] : def; };
const has = (name) => { const i = args.indexOf('--' + name); if (i >= 0) args.splice(i, 1); return i >= 0; };

function project(dirArg) {
  const dir = path.resolve(dirArg || '.');
  const f = path.join(dir, 'edit.json');
  if (!fs.existsSync(f)) throw new Error(`no edit.json in ${dir} (run: shortsmith init ${dirArg || '.'} --source <video> --preset <id>)`);
  const edit = readJson(f);
  const loaded = loadPreset(edit.preset, dir);
  loaded.preset.cut = { ...loaded.preset.cut, ...(edit.cut || {}) };
  if (loaded.preset.renderer === 'legacy-ass' && ['scene', 'render', 'build', 'still'].includes(cmd)) {
    throw new Error(`preset ${loaded.preset.id} has no React renderer yet (renderer: legacy-ass); cuts and body still work`);
  }

  return { dir, edit, loaded };
}

async function cuts(P) {
  // levelSource: optional measuring-only track (e.g. band-limited copy of a noisy source)
  const L = analyze(path.resolve(P.dir, P.edit.levelSource || P.edit.source), P.loaded.preset.cut);
  const pieces = planCuts(L, P.edit.keep);
  const total = pieces.reduce((a, p) => a + p.e - p.s, 0);
  writeJson(path.join(P.dir, 'cuts.json'), { source: P.edit.source, pieces, total: +total.toFixed(3) });
  log(`cuts: ${pieces.length} pieces, ${total.toFixed(2)}s of ${L.dur.toFixed(2)}s`);
  return pieces;
}
const cutsOf = (P) => readJson(path.join(P.dir, 'cuts.json')).pieces;

const COMMANDS = {
  async help() {
    console.log(`shortsmith <command> [project dir]

  doctor [--preset id]      check ffmpeg, GPU encoder, fonts and preset files
  presets                   list presets (project ./presets, SHORTSMITH_PRESETS, bundled)
  init <dir> --source f --preset id
  cuts [dir]                waveform cut points for edit.keep -> cuts.json
  body [dir]                cut + crop + audio -> window.mkv, bg.mp4 (GPU, cached per piece)
  scene [dir]               captions + fx.json + preset -> scene.json
  render [dir] [--out f]    scene.json -> mp4 (only changed 2s chunks re-render)
  build [dir] [--recut]     everything that is missing or stale
  still <dir> <sec> <png>   one full frame for checking a design
  map [dir] <sourceSec>     source time -> output time`);
  },

  async doctor() {
    const ff = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' });
    console.log(ff.status === 0 ? 'ffmpeg   ok  ' + ff.stdout.split('\n')[0] : 'ffmpeg   MISSING - install ffmpeg and put it on PATH');
    if (ff.status !== 0) return;
    console.log('encoder  ' + encoder().name);
    const id = flag('preset');
    const ids = id ? [id] : listPresets().map((p) => p.file);
    for (const p of ids) {
      const { preset, missing } = loadPreset(p);
      console.log(`preset   ${preset.id} - ${missing.length ? missing.length + ' missing' : 'ok'}`);
      for (const m of missing) console.log(`         missing ${m.what}${m.get ? '  (get: ' + m.get + ')' : ''}`);
    }
  },

  async presets() {
    for (const p of listPresets()) console.log(`${p.id.padEnd(24)} ${p.visibility.padEnd(8)} ${p.name}  (${p.file})`);
  },

  async init() {
    const dir = path.resolve(args[0] || '.');
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, 'edit.json');
    if (fs.existsSync(f)) throw new Error('edit.json already exists');
    writeJson(f, { preset: flag('preset', 'basic-shorts'), source: flag('source', 'source.mp4'), crop: null, keep: [],
      captions: 'captions.csv', captionClock: 'output', fx: 'fx.json', out: 'out/short.mp4' });
    log('wrote', f);
  },

  async cuts() { await cuts(project(args[0])); },
  async body() { const P = project(args[0]); await buildBody(P.dir, P.edit, P.loaded.preset, cutsOf(P)); },
  async scene() {
    const P = project(args[0]);
    const s = buildScene(P.dir, P.edit, P.loaded, readJson(path.join(P.dir, 'body.json')), cutsOf(P));
    log(`scene: ${s.captions.length} captions, ${s.overlays.length} overlays, ${s.fx.length} effects, ${s.duration}s`);
  },
  async render() {
    const P = project(args[0]);
    await renderScene(path.join(P.dir, 'scene.json'), path.resolve(P.dir, flag('out', P.edit.out || 'out/short.mp4')));
  },

  async build() {
    const recut = has('recut');
    const P = project(args[0]);
    for (const m of P.loaded.missing) console.warn('warning: missing', m.what);
    const pieces = recut || !fs.existsSync(path.join(P.dir, 'cuts.json')) ? await cuts(P) : cutsOf(P);
    const body = await buildBody(P.dir, P.edit, P.loaded.preset, pieces);
    buildScene(P.dir, P.edit, P.loaded, body, pieces);
    await renderScene(path.join(P.dir, 'scene.json'), path.resolve(P.dir, flag('out', P.edit.out || 'out/short.mp4')));
  },

  async still() {
    const [dir, sec, out] = args;
    await still(path.join(path.resolve(dir), 'scene.json'), +sec, out);
    log('wrote', out);
  },

  async map() {
    const t = +args[args.length - 1];
    const P = project(args.length > 1 ? args[0] : '.');
    const o = toOutput(cutsOf(P), t, P.edit.speed || 1);
    console.log(o == null ? 'cut away' : o.toFixed(3));
  },
};

(COMMANDS[cmd] || COMMANDS.help)().then(() => process.exit(0)).catch((e) => { console.error('error:', e.message); process.exit(1); });
