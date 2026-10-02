import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { md5, readJson, resolveFrom, sig, slash, toOutput, writeJson } from './util.mjs';

/* captions + fx.json + preset -> scene.json.

   fx.json is the only per-video file an editor (or Claude) writes by hand. Places are named by caption text,
   so when cuts move and times shift, effects still land on the right line:
   {
     "title": "optional, else the caption row with speaker 'title'",
     "face": [540, 920],
     "kinds":  { "예?": "react" },
     "labels": [{ "text": "...", "from": 0, "to": "제가요?", "y": 490 }],
     "images": [{ "src": "a.png", "from": "line A", "to": "line B", "x": 225, "y": 1030, "w": 380 }],
                 spin: { period, from } turns it, one turn per period seconds, from that caption on
                 lead: seconds to show it before "from" (a chat the host answers comes up before her reply)
     "chats":  [{ "lines": ["...", "..."], "from": "line A", "to": "line B" }],
     "bubbles": [{ "from": "line A", "to": "line B", "box": [950, 300, 1820, 660], "tail": [[956, 415], [876, 510], [956, 545]] }],
     "inserts": [{ "from": "line A", "to": "line B", "grab": 123.4, "rect": [1500, 80, 400, 300] }],   grab = source seconds
     "fx": [{ "type": "zoom", "z": 1.2, "at": ["예?"] },
            { "type": "push", "from": "line A", "to": "line B", "z0": 1, "z1": 1.15 },
            { "type": "shake", "at": ["line C"], "amp": 12 }, { "type": "mono", "at": ["line C"] }]
   }
   from / to: number = seconds, text = start of that caption, null = end of video. "text#2" = third match.
   at: while that caption is on screen. A key that matches no caption is an error - silently dropping an effect
   hides the mistake. */
const MARK = /«(.+?)\|([A-Za-z]+)»/g;
const plain = (t) => t.replace(MARK, '$1');
const TITLE = new Set(['title', '제목']);

function parseTime(v) {
  if (typeof v === 'number') return v;
  const m = String(v).trim().match(/^(-?\d+):(\d+):(\d+(?:\.\d+)?)$/);
  return Math.max(0, m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : parseFloat(v));
}

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.some((c) => c.trim()));
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

/* Captions file: .csv (start,end,speaker,text) or .json [{s,e,text,speaker}].
   clock: "output" (default, final seconds), "timeline" (cut timeline before edit.speed) or "source" (source seconds). */
export function readCaptions(file, { clock = 'output', pieces = [], speed = 1, skip = new Set() } = {}) {
  const raw = file.endsWith('.json')
    ? readJson(file).map((c) => ({ start: c.s ?? c.start, end: c.e ?? c.end, speaker: c.speaker || '', text: c.text }))
    : parseCsv(fs.readFileSync(file, 'utf8'));
  let title = null;
  const rows = [];
  for (const r of raw) {
    const spk = (r.speaker || '').trim();
    if (TITLE.has(spk)) { title = r.text; continue; }
    if (skip.has(spk)) continue;
    let s = parseTime(r.start), e = parseTime(r.end);
    if (clock === 'timeline') { s /= speed; e /= speed; }   // cut timeline before the speed-up
    if (clock === 'source') {
      s = toOutput(pieces, s, speed); e = toOutput(pieces, e, speed);
      if (s == null || e == null) continue;           // cut away
    }
    // kind 칸: 자막 디자인 이름 (기본 · 강조 · 슬픔 · 부분 강조 ...). 화자 칸은 화자 그대로 둔다
    rows.push({ s: +s.toFixed(3), e: +e.toFixed(3), text: r.text, speaker: spk, kind: (r.kind || '').trim() });
  }
  return { rows, title };
}

export function buildScene(projectDir, edit, loaded, body, cutsList) {
  const { preset } = loaded;
  const fxFile = resolveFrom(projectDir, edit.fx || 'fx.json');
  const fx = fs.existsSync(fxFile) ? readJson(fxFile) : {};
  const capFile = resolveFrom(projectDir, edit.captions);
  const C = preset.captions;
  const speakers = C.speakers || {};          // speaker name -> kind ("HostAngry": "outburst"); null = skip the row
  // kindNames: captions.csv 의 kind 칸에 적는 우리말 이름 -> 종류 ("강조": "accent"). 없으면 종류 이름 그대로
  const skip = new Set(Object.entries(speakers).filter(([, k]) => k === null).map(([n]) => n));
  const { rows, title } = capFile && fs.existsSync(capFile)
    ? readCaptions(capFile, { clock: edit.captionClock || 'output', pieces: cutsList, speed: edit.speed || 1, skip })
    : { rows: [], title: null };
  // close short gaps so captions do not blink off between lines (the legacy rebuild_from_csv did this)
  const gapSec = C.rules?.fillGapsSec;
  if (gapSec) {
    const flow = rows.filter((r) => !(C.rules.fillGapsSkip || []).includes(r.speaker));
    for (let i = 0; i < flow.length - 1; i++) {
      const g = flow[i + 1].s - flow[i].e;
      if (g > 0 && g <= gapSec) flow[i].e = flow[i + 1].s;
    }
    if (C.rules.extendLast && flow.length) flow[flow.length - 1].e = Math.max(flow[flow.length - 1].e, body.duration);
  }
  const dur = body.duration;

  const find = (key) => {
    const [name, nth] = String(key).split('#');
    const hit = rows.filter((r) => plain(r.text) === name);
    if (hit.length <= +(nth || 0)) throw new Error(`fx.json: no caption "${key}"`);
    return hit[+(nth || 0)];
  };
  const at = (v) => (v == null ? dur : typeof v === 'number' ? v : find(v).s);

  const kinds = fx.kinds || {};
  Object.keys(kinds).forEach(find);
  const def = C.defaultKind;
  const guests = { ...(C.guests || {}) }, palette = [...(C.guestPalette || [])];
  const kindOfSpeaker = (spk) => {
    if (speakers[spk]) return { kind: speakers[spk] };
    const suf = Object.entries(C.speakerSuffix || {}).find(([sfx]) => spk.endsWith(sfx));
    if (suf) return { kind: suf[1] };
    if (!spk || !C.guestKind || (C.host && spk.startsWith(C.host))) return { kind: def };
    if (!guests[spk]) guests[spk] = { fill: palette.shift() || '#A987BE' };   // new guest: next palette color
    return { kind: C.guestKind, color: guests[spk].fill };
  };
  const captions = rows.map((r, i) => {
    const bySpk = kindOfSpeaker(r.speaker);
    const byKindCol = r.kind ? (C.kindNames?.[r.kind] ?? (C.kinds[r.kind] ? r.kind : null)) : null;
    return { id: `c${i}`, s: r.s, e: r.e, text: r.text, kind: kinds[plain(r.text)] || byKindCol || bySpk.kind, ...(bySpk.color ? { color: bySpk.color } : {}) };
  });
  (fx.labels || []).forEach((l, i) => captions.push({ id: `l${i}`, s: at(l.from ?? 0), e: at(l.to), text: l.text, kind: l.kind || 'label', ...(l.y != null ? { y: l.y } : {}), ...(l.x != null ? { x: l.x } : {}) }));

  const overlays = [
    ...(fx.images || []).map((m) => ({ type: 'image', s: Math.max(0, at(m.from) - (m.lead || 0)),
      // an image whose "to" is the next image's "from" ends when that one comes up (its lead would overlap them)
      e: at(m.to) - ((fx.images.find((n) => n !== m && n.from === m.to)?.lead) || 0), src: m.src, x: m.x, y: m.y, w: m.w, ...pick(m, ['border', 'anchor', 'pop', 'bounce']),
      ...(m.spin ? { spin: { period: m.spin.period, s: at(m.spin.from ?? m.from) } } : {}) })),
    ...(fx.chats || []).map((c) => ({ type: 'chat', s: at(c.from), e: at(c.to), lines: c.lines, ...pick(c, ['x', 'y', 'scale']) })),
  ];
  // bubbles (roleplay speech bubble shapes)
  for (const b of fx.bubbles || []) overlays.push({ type: 'bubble', s: at(b.from), e: at(b.to), box: b.box, ...pick(b, ['radius', 'tail', 'fill', 'stroke']) });
  // inserts: cut a still out of the source at `grab` (source seconds) and show it enlarged; captions hide meanwhile
  const hideCaptions = [];
  const I = preset.inserts || {};
  for (const n of fx.inserts || []) {
    const src = path.resolve(projectDir, edit.source), [rx, ry, rw, rh] = n.rect;
    const rel = `cache/still_${md5([sig(src), n.grab, n.rect])}.png`;   // relative: ffmpeg fails on some non-ASCII absolute image paths
    if (!fs.existsSync(path.join(projectDir, rel))) {
      fs.mkdirSync(path.join(projectDir, 'cache'), { recursive: true });
      const r = spawnSync('ffmpeg', ['-y', '-v', 'error', '-ss', String(n.grab), '-i', src, '-frames:v', '1', '-vf', `crop=${rw}:${rh}:${rx}:${ry}`, rel], { cwd: projectDir, encoding: 'utf8' });
      if (r.status) throw new Error('insert still failed: ' + r.stderr);
    }
    const s = at(n.from), e = at(n.to);
    const bg = n.background || I.background;
    // area 'window': cover only the video window so the preset background (name plate, frame) stays. Default when the
    // insert has no background image of its own - a black full-canvas box hid the brand background (생일방송컨, 2026-09-18)
    const area = n.area ?? I.area ?? (bg ? 'canvas' : 'window');
    const box = area === 'window' ? { w: preset.layout.window.w, h: body.windowH } : { w: preset.canvas.width, h: preset.canvas.height };
    overlays.push({ type: 'insert', s, e, src: rel, srcW: rw, srcH: rh, area,
      ...(bg ? { background: { src: bg, scale: n.bgScale ?? I.bgScale ?? 1 } } : {}),
      maxW: n.maxW ?? I.maxW ?? box.w * (area === 'window' ? 0.9 : 0.75), maxH: n.maxH ?? I.maxH ?? box.h * (area === 'window' ? 0.9 : 1),
      maxZoom: n.maxZoom ?? I.maxZoom ?? 6 });
    if (n.hideCaptions ?? I.hideCaptions ?? true) hideCaptions.push([s, e]);
  }
  const effects = [];
  for (const f of fx.fx || []) {
    const extra = Object.fromEntries(Object.entries(f).filter(([k]) => !['type', 'at', 'from', 'to'].includes(k)));
    if (f.at) for (const key of f.at) { const r = find(key); effects.push({ type: f.type, s: r.s, e: r.e, ...extra }); }
    else effects.push({ type: f.type, s: at(f.from), e: at(f.to), ...extra });
  }

  const W = preset.layout.window;
  const scene = {
    fps: preset.canvas.fps, width: preset.canvas.width, height: preset.canvas.height, duration: dur,
    style: preset,
    body: { window: 'window.mkv', windowPreview: 'window_preview.mp4', bg: 'bg.mp4',
      ...(fs.existsSync(path.join(projectDir, 'bg_preview.mp4')) ? { bgPreview: 'bg_preview.mp4' } : {}),
      crossfadeSec: body.crossfadeSec ?? 0 },
    window: { x: W.x, y: W.y, w: W.w, h: body.windowH },
    face: fx.face || preset.layout.face || [W.x + W.w / 2, W.y + body.windowH / 2],
    title: (fx.title || title) ? { text: fx.title || title } : null,
    captions, overlays, fx: effects, kinds, hideCaptions,
    // hand-laid extra tracks (edit.json layers, written by the dashboard user edit tab via tools/apply_review.py) - output seconds
    ...(Array.isArray(edit.layers) && edit.layers.length ? { layers: edit.layers.filter((L) => L && L.src && L.e > L.s) } : {}),
  };
  writeJson(path.join(projectDir, 'scene.json'), scene);
  return scene;
}

const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] != null).map((k) => [k, o[k]]));
export { slash };
