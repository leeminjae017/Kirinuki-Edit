import fs from 'node:fs';
import path from 'node:path';
import { encoder } from './encoder.mjs';
import { duration, log, loudness, md5, run, sig, slash, spawnPromise, writeJson } from './util.mjs';

/* ffmpeg part 1: cut, crop and audio. Outputs in the project folder:
     cache/win_<key>.mkv   one piece = source s-e cropped to window width (H.264, PCM + 8ms fades)
     window.mkv            pieces joined with -c copy; React/ffmpeg place it in the window; audio comes from here
     window_preview.mp4    dashboard preview: 30fps 720 wide, AAC (browsers cannot play PCM in mkv)
     bg_preview.mp4        dashboard preview background: 30fps 540 wide
     bg.mp4                preset background for the whole duration (no audio)
     body.json             duration, window height, piece keys (render.mjs cache keys)
   Per-piece AAC would add priming/padding at every joint and click; audio is encoded once, at the end.
   Only gain (volume=NdB) is ever applied - no denoise, highpass, limiter or loudnorm unless the user asks. */
const VERSION = 3;
const FPS_DEFAULT = 60;

export async function buildBody(projectDir, edit, preset, cutsList) {
  const cache = path.join(projectDir, 'cache');
  fs.mkdirSync(cache, { recursive: true });
  const enc = encoder();
  const src = path.resolve(projectDir, edit.source);
  // Audio that starts later than the video (2시.mp4 from Quick Share: audio start_time 0.450) puts every time measured on
  // an extracted wav 0.45s early - cuts then chop line endings and captions look early. Cuts here run on the video clock,
  // so any analysis wav must be padded to it (adelay in ms - a sample count is read at the input rate).
  const st = run('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,start_time', '-of', 'csv=p=0', src], 'probe start').stdout
    .trim().split(/\s+/).map((l) => l.split(',')).reduce((o, [k, v]) => ((o[k] ??= +v), o), {});
  if (st.audio != null && st.video != null && Math.abs(st.audio - st.video) > 0.01)
    log(`WARNING: source audio starts ${(st.audio - st.video).toFixed(3)}s after the video - pad analysis wavs by that much (adelay=<ms>)`);
  const C = edit.crop || { x: 0, y: 0, w: 1920, h: 1080 };
  // speed: whole-video speed-up the user asked for (picture and voice together, atempo keeps the pitch)
  const speed = edit.speed || 1;
  const W = preset.layout.window, fps = preset.canvas.fps || FPS_DEFAULT;
  const wh = W.h || Math.round(W.w * C.h / C.w / 2) * 2;
  if (preset.brand?.background?.file && !preset.brand.background.path) throw new Error('background file missing: ' + preset.brand.background.file);
  const fade = preset.audio?.fadeSec ?? 0.008;
  const sigs = {};
  const sigOf = (f) => (sigs[f] ??= sig(f));

  const clips = [], keys = [], jobs = [], parts = [];
  let cur = 0, fresh = 0, mainDur = 0;
  for (const pc of cutsList) {
    if (pc.gap) {
      // a cut left open (keep entry { gap }): black window and silence, same streams as the other pieces for -c copy
      const outDur = +(pc.e - pc.s).toFixed(3);
      const key = md5([VERSION, 'gap', outDur, W.w, wh, fps, enc.name]);
      const out = path.join(cache, `win_${key}.mkv`);
      if (!fs.existsSync(out)) {
        jobs.push(['-y', '-v', 'error', '-f', 'lavfi', '-i', `color=black:s=${W.w}x${wh}:r=${fps}`, '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo',
          '-t', outDur.toFixed(3), '-vf', 'setsar=1,format=nv12', ...enc.args, '-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '2', out + '.tmp.mkv']);
        fresh++;
      } else fs.utimesSync(out, new Date(), new Date());
      clips.push(out);
      keys.push([key, +cur.toFixed(3), outDur]);
      mainDur = cur + outDur;
      cur += outDur;
      continue;
    }
    // pieces from another file (an outro) keep their own speed and get their own loudness: measuring the joined audio
    // would let the louder part decide the gain for both
    const sp = pc.source ? 1 : speed;
    const dur = +(pc.e - pc.s).toFixed(3), outDur = +(dur / sp).toFixed(3);
    const file = pc.source ? path.resolve(projectDir, pc.source) : src;
    let gainDb = pc.gainDb || 0;
    if (pc.source && preset.audio?.targetLufs != null) {
      const L = loudness(file);
      gainDb = +Math.min(preset.audio.targetLufs - L.I, (preset.audio.maxTruePeakDb ?? -1.5) - L.TP).toFixed(2);
    }
    const gain = gainDb ? `volume=${gainDb}dB,` : '';
    const pcC = pc.crop || (pc.source ? null : C);
    // a piece's own crop may have another aspect: fill the window, trimming the excess (no stretching)
    const vcrop = pcC ? `crop=${pcC.w}:${pcC.h}:${pcC.x}:${pcC.y},` : '';
    const vf = `${vcrop}scale=${W.w}:${wh}:force_original_aspect_ratio=increase:flags=lanczos,crop=${W.w}:${wh},setsar=1`
      + (sp !== 1 ? `,setpts=(PTS-STARTPTS)/${sp}` : '') + `,fps=${fps},format=nv12`;
    const af = `${gain}${sp !== 1 ? `atempo=${sp},` : ''}aresample=48000,afade=t=in:st=0:d=${fade},afade=t=out:st=${Math.max(0, outDur - fade).toFixed(3)}:d=${fade}`;
    const key = md5([VERSION, sigOf(file), pc.s, dur, vf, af, enc.name]);
    const out = path.join(cache, `win_${key}.mkv`);
    if (!fs.existsSync(out)) {
      jobs.push(['-y', '-v', 'error', '-ss', pc.s.toFixed(3), '-t', dur.toFixed(3), '-i', file,
        '-vf', vf, '-af', af, '-t', outDur.toFixed(3), ...enc.args, '-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '2', out + '.tmp.mkv']);
      fresh++;
    } else fs.utimesSync(out, new Date(), new Date());
    clips.push(out);
    keys.push([key, +cur.toFixed(3), outDur]);
    parts.push({ file, s: pc.s, e: pc.e, sp, gain, at: cur, outDur });
    if (!pc.source) mainDur = cur + outDur;
    cur += outDur;
  }
  // pieces encode three at a time (one at a time took 2m32s for 21 pieces)
  const pool = async () => {
    for (let j; (j = jobs.shift());) {
      const { done } = spawnPromise('ffmpeg', j, { stdio: ['ignore', 'ignore', 'inherit'] });
      await done;
      const tmp = j[j.length - 1];
      fs.renameSync(tmp, tmp.slice(0, -'.tmp.mkv'.length));
    }
  };
  await Promise.all([pool(), pool(), pool()]);
  const list = path.join(cache, 'concat.txt');
  fs.writeFileSync(list, clips.map((c) => `file '${path.basename(c)}'`).join('\n'));
  run('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', path.join(projectDir, 'window.mkv')], 'join pieces');
  // Crossfade at joins (user asked, 2026-09-18 생일방송컨: loud music jumped at every cut). Audio only, centered on the
  // cut: piece A runs xf/2 past its end fading out while B starts xf/2 early fading in. Picture cuts and the total
  // length stay the same, so caption times do not move. No other processing - it is a transition, not a filter.
  const xf = edit.crossfadeSec ?? preset.audio?.crossfadeSec ?? 0;
  if (xf > 0 && parts.length > 1) {
    const h = xf / 2, ins = [], ch = [];
    parts.forEach((q, i) => {
      const h0 = i ? Math.min(h, q.s / q.sp) : 0, h1 = i < parts.length - 1 ? h : 0;
      const len = q.outDur + h0 + h1;
      ins.push('-ss', (q.s - h0 * q.sp).toFixed(3), '-t', ((q.e - q.s) + (h0 + h1) * q.sp).toFixed(3), '-i', q.file);
      const f = [q.gain.replace(/,$/, ''), q.sp !== 1 ? `atempo=${q.sp}` : '', 'aresample=48000', 'aformat=channel_layouts=stereo',
        h0 ? `afade=t=in:st=0:d=${(2 * h0).toFixed(3)}` : `afade=t=in:st=0:d=${fade}`,
        `afade=t=out:st=${Math.max(0, len - (h1 ? 2 * h1 : fade)).toFixed(3)}:d=${(h1 ? 2 * h1 : fade).toFixed(3)}`,
        `adelay=${Math.round((q.at - h0) * 1000)}:all=1`].filter(Boolean).join(',');
      ch.push(`[${i}:a]${f}[a${i}]`);
    });
    const fc = ch.join(';') + ';' + parts.map((_, i) => `[a${i}]`).join('') + `amix=inputs=${parts.length}:normalize=0:dropout_transition=0,atrim=0:${cur.toFixed(3)}[mix]`;
    const wav = path.join(cache, 'xfade.wav'), win = path.join(projectDir, 'window.mkv'), tmp = path.join(cache, 'window_xf.mkv');
    run('ffmpeg', ['-y', '-v', 'error', ...ins, '-filter_complex', fc, '-map', '[mix]', '-c:a', 'pcm_s16le', '-ar', '48000', wav], 'crossfade audio');
    run('ffmpeg', ['-y', '-v', 'error', '-i', win, '-i', wav, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'pcm_s16le', tmp], 'crossfade mux');
    fs.renameSync(tmp, win);
  }
  // Dashboard preview files are separate and light: 30fps, smaller, a keyframe every 0.5s. Copying the 60fps render
  // stream made the browser decode two 60fps 1080p videos at once - the background fell to ~0.4x speed and the
  // window froze now and then while the captions (drawn by React) kept moving (생일방송컨, 2026-09-18).
  const light = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-g', '15', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'];
  // The preview gets the same fixed gain the render adds at the end - without it the dashboard played the raw window
  // audio, 20dB quieter than the final on a quiet source (생일방송컨, 2026-09-18). Same formula as render.mjs.
  const total = duration(path.join(projectDir, 'window.mkv'));
  const mainOnly = mainDur < total - 0.05 ? mainDur : null;
  const L = loudness(path.join(projectDir, 'window.mkv'), mainOnly);
  const pg = Math.min((preset.audio?.targetLufs ?? -16) - L.I, (preset.audio?.maxTruePeakDb ?? -1.5) - L.TP);
  run('ffmpeg', ['-y', '-v', 'error', '-i', path.join(projectDir, 'window.mkv'), '-vf', 'fps=30,scale=720:-2',
    ...light, '-af', `volume=${pg.toFixed(2)}dB` + (mainOnly ? `:enable='lt(t,${mainOnly.toFixed(3)})'` : ''),
    '-c:a', 'aac', '-b:a', '160k', path.join(projectDir, 'window_preview.mp4')], 'preview window');
  const d = duration(path.join(projectDir, 'window.mkv'));

  let bgKey = null;
  const bgFile = preset.brand?.background?.path;
  const bgOut = path.join(projectDir, 'bg.mp4');
  if (bgFile) {
    bgKey = md5([VERSION, sig(bgFile), preset.brand.background.offset || 0, +d.toFixed(2), preset.canvas, enc.name]);
    const bg = path.join(cache, `bg_${bgKey}.mp4`);
    if (!fs.existsSync(bg)) {
      run('ffmpeg', ['-y', '-v', 'error', '-stream_loop', '-1', '-ss', String(preset.brand.background.offset || 0), '-i', bgFile,
        '-t', (d + 1).toFixed(3), '-vf', `scale=${preset.canvas.width}:${preset.canvas.height},fps=${fps},format=nv12`, '-an',
        ...enc.args, '-movflags', '+faststart', bg], 'background');
    }
    fs.copyFileSync(bg, bgOut);
    const bgp = path.join(cache, `bgp_${bgKey}.mp4`);
    if (!fs.existsSync(bgp)) run('ffmpeg', ['-y', '-v', 'error', '-i', bg, '-vf', 'fps=30,scale=540:-2', '-an', ...light, bgp], 'preview background');
    fs.copyFileSync(bgp, path.join(projectDir, 'bg_preview.mp4'));
  } else {
    bgKey = md5([VERSION, 'black', +d.toFixed(2), preset.canvas, enc.name]);
    run('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', `color=black:s=${preset.canvas.width}x${preset.canvas.height}:r=${fps}`,
      '-t', (d + 1).toFixed(3), '-vf', 'format=nv12', ...enc.args, bgOut], 'black background');
  }

  const old = Date.now() - 7 * 86400e3;
  for (const n of fs.readdirSync(cache)) {
    const p = path.join(cache, n);
    if (/^(win|bgp?)_/.test(n) && fs.statSync(p).mtimeMs < old) fs.rmSync(p);
  }
  const body = { duration: +d.toFixed(3), mainDuration: +mainDur.toFixed(3), windowH: wh, bg: bgKey, encoder: enc.name, pieces: keys, crossfadeSec: edit.crossfadeSec ?? preset.audio?.crossfadeSec ?? 0 };
  writeJson(path.join(projectDir, 'body.json'), body);
  log(`body: ${clips.length} pieces (${fresh} new, ${enc.name}) · window.mkv ${d.toFixed(2)}s · window ${W.w}x${wh}`);
  return body;
}

export { slash };
