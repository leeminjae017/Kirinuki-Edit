import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, slash } from './util.mjs';

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* Where presets are looked up, first hit wins:
   1. an explicit path to preset.json or its folder
   2. presets/<id> in the project folder or any folder above it (private presets live next to projects)
   3. every folder in SHORTSMITH_PRESETS (path-list separated)
   4. presets bundled with the package */
export function presetDirs(projectDir) {
  const env = (process.env.SHORTSMITH_PRESETS || '').split(path.delimiter).filter(Boolean);
  const up = [];
  for (let d = path.resolve(projectDir); ; d = path.dirname(d)) {
    up.push(path.join(d, 'presets'));
    if (path.dirname(d) === d) break;
  }
  return [...new Set([...up, ...env, path.join(PKG, 'presets')])];
}

export function findPreset(idOrPath, projectDir = process.cwd()) {
  const direct = path.resolve(projectDir, idOrPath);
  if (fs.existsSync(direct)) {
    const f = fs.statSync(direct).isDirectory() ? path.join(direct, 'preset.json') : direct;
    if (fs.existsSync(f)) return f;
  }
  for (const d of presetDirs(projectDir)) {
    const f = path.join(d, idOrPath, 'preset.json');
    if (fs.existsSync(f)) return f;
  }
  throw new Error(`preset not found: ${idOrPath} (looked in ${presetDirs(projectDir).join(', ')})`);
}

export function listPresets(projectDir = process.cwd()) {
  const out = [];
  for (const d of presetDirs(projectDir)) {
    if (!fs.existsSync(d)) continue;
    for (const n of fs.readdirSync(d)) {
      const f = path.join(d, n, 'preset.json');
      if (fs.existsSync(f)) { const p = readJson(f); out.push({ id: p.id, name: p.name, file: f, visibility: p.visibility || 'public' }); }
    }
  }
  return out;
}

export function fontDirs(presetDir) {
  const dirs = [path.join(presetDir, 'fonts')];
  if (process.env.SHORTSMITH_FONTS) dirs.push(...process.env.SHORTSMITH_FONTS.split(path.delimiter));
  if (process.platform === 'win32') {
    dirs.push(path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Windows', 'Fonts'), path.join(process.env.WINDIR || 'C:/Windows', 'Fonts'));
  } else if (process.platform === 'darwin') {
    dirs.push(path.join(os.homedir(), 'Library', 'Fonts'), '/Library/Fonts', '/System/Library/Fonts');
  } else {
    dirs.push(path.join(os.homedir(), '.fonts'), path.join(os.homedir(), '.local', 'share', 'fonts'), '/usr/share/fonts', '/usr/local/share/fonts');
  }
  return dirs;
}

function findFile(name, dirs) {
  const lower = name.toLowerCase();
  for (const d of dirs) {
    if (!d || !fs.existsSync(d)) continue;
    const hit = fs.readdirSync(d).find((n) => n.toLowerCase() === lower);
    if (hit) return path.join(d, hit);
  }
  return null;
}

/* Load a preset and fill in absolute paths (fonts, background, chat icon). Missing files are reported, not fatal. */
export function loadPreset(idOrPath, projectDir = process.cwd()) {
  const file = findPreset(idOrPath, projectDir);
  const dir = path.dirname(file);
  const p = readJson(file);
  if (p.extends) {
    const base = loadPreset(p.extends, projectDir).preset;
    deepMerge(base, p);
    Object.assign(p, base);
  }
  const missing = [];
  const fdirs = fontDirs(dir);
  for (const [k, f] of Object.entries(p.fonts || {})) {
    // file may list several names - the same font ships as e.g. BlackHanSans-Regular.ttf or "Black Han Sans Regular.TTF"
    const names = [].concat(f.file || []);
    const hit = names.map((n) => findFile(n, fdirs)).find(Boolean) || null;
    if (hit) f.path = slash(hit); else missing.push({ what: `font ${k}: ${f.family}`, get: f.get });
  }
  const rel = (obj, key, label) => {
    if (!obj || !obj[key]) return;
    const abs = path.isAbsolute(obj[key]) ? obj[key] : path.join(dir, obj[key]);
    if (fs.existsSync(abs)) obj.path = slash(abs); else missing.push({ what: `${label}: ${obj[key]}` });
  };
  rel(p.brand?.background, 'file', 'background');
  rel(p.chat?.icon, 'file', 'chat icon');
  return { preset: p, file, dir, missing };
}

function deepMerge(base, over) {
  for (const [k, v] of Object.entries(over)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object') deepMerge(base[k], v);
    else base[k] = v;
  }
}
