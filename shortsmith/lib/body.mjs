import fs from 'node:fs';
import path from 'node:path';
import { encoder } from './encoder.mjs';
import { curvesVf } from './color.mjs';
import { XFADE } from './trans.mjs';
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

/* Camera (edit.camera.keys): the crop box follows keyframes in source time - [{ t, x, y, h, in }], source pixels, box width
   = h * window aspect. A key holds until the next one; a next key with in: "linear" is reached at constant speed, anything
   else is a cut on that frame. A held span is a plain crop (cached like any piece). A run of linear keys - a tracking camera
   puts one every frame it moves - becomes one moving span of up to maxLen seconds / maxPts keys whose box is a
   piecewise-linear path, drawn by
   perspective (sub-pixel, per frame; an integer crop x/y steps visibly on slow pans once magnified 2x).
   Dance reference (Damyui-n152-1, 2026-10-01): the camera follows the body almost all the time, a few one-frame cuts. */
// Long spans: every piece pays ~2s to open the GPU encoder (measured h264_qsv: 6 frames 2.17s, 180 frames 2.38s), so 3s / 40-key
// spans (18 pieces for 23s, 허니하트) spent most of the body time starting encoders. The path goes to ffmpeg in a file (-/vf),
// so the 32K command line no longer caps it.
export function cameraSpans(keys, s, e, aspect, SW, SH, fps, maxLen = 60, maxPts = Infinity) {
  const snap = (t) => Math.round(t * fps) / fps;
  const K = keys.map((k) => ({ ...k, t: snap(k.t) })).sort((a, b) => a.t - b.t);
  const boxOf = (k, exact) => {
    const R = exact ? (v) => Math.round(v * 100) / 100 : Math.round;
    const h = Math.min(SH, R(k.h)), w = Math.min(SW, R(h * aspect));
    return { x: R(Math.max(0, Math.min(SW - w, k.x))), y: R(Math.max(0, Math.min(SH - h, k.y))), w, h };
  };
  const lerp = (a, b, u) => ({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, h: a.h + (b.h - a.h) * u });
  const at = (t) => {                               // box at t and whether it is moving towards the next key
    let i = 0;
    while (i + 1 < K.length && K[i + 1].t <= t + 1e-6) i++;
    const a = K[i], b = K[i + 1];
    if (t < a.t - 1e-6 || !b || b.in !== 'linear') return { box: boxOf(a), i, moving: false };
    return { box: boxOf(lerp(a, b, (t - a.t) / (b.t - a.t)), true), i, moving: true };
  };
  // one boundary per frame time - two keys on the same frame made a 0s piece that ffmpeg wrote as a broken file (2.7s went missing)
  const cuts = [...new Set([s, ...K.map((k) => k.t).filter((t) => t > s + 0.5 / fps && t < e - 0.5 / fps), e])];
  const out = [];
  for (let j = 0; j + 1 < cuts.length; j++) {
    const a = cuts[j], b = cuts[j + 1], A = at(a);
    if (b - a < 0.5 / fps) continue;
    const last = out[out.length - 1];
    const end = A.moving ? boxOf(lerp(K[A.i], K[A.i + 1], (b - K[A.i].t) / (K[A.i + 1].t - K[A.i].t)), true) : A.box;
    // Join the previous span when it ends here and stays under maxLen. A different box at the join is a cut: a jump point,
    // drawn on exactly this frame. Each piece pays ~2s to start the GPU encoder, so holds and cuts no longer start pieces
    // of their own (the 1-frame hold before every cut was one: 14 pieces for 23s, 허니하트). Box values of a hold are
    // rounded to whole px, a path's to 0.01 - within 0.51px they are the same box.
    if (last && Math.abs(last.e - a) < 1e-6 && b - last.s <= maxLen + 1e-6 && last.path.length < maxPts) {
      const p = last.path[last.path.length - 1].box;
      if (!['x', 'y', 'w', 'h'].every((c) => Math.abs(p[c] - A.box[c]) <= 0.51)) last.path.push({ t: a, box: A.box, jump: true });
      last.path.push({ t: b, box: end }); last.e = b;
    } else out.push({ s: a, e: b, path: [{ t: a, box: A.box }, { t: b, box: end }] });
  }
  return out;
}

/* perspective corners for a path span: v(f) = v0 + sum of each leg's change * clip((f - f_k) / len_k, 0, 1), f = frame in the
   piece. perspective counts input frames from 1 - using in/N ran a frame ahead (measured 4.5px on a 119px pan).
   The source is first cropped to the area the path sweeps (even offsets, a few px of margin for the cubic taps): perspective
   works on every pixel of its input, and the full 1726x1080 frame was 3-10x the box it draws from. */
export function pathVf(path, s, fps, SW = Infinity, SH = Infinity) {
  const M = 4;
  const ox = Math.max(0, Math.floor((Math.min(...path.map((p) => p.box.x)) - M) / 2) * 2);
  const oy = Math.max(0, Math.floor((Math.min(...path.map((p) => p.box.y)) - M) / 2) * 2);
  const cw = Math.floor((Math.min(SW, Math.ceil(Math.max(...path.map((p) => p.box.x + p.box.w)) + M)) - ox) / 2) * 2;
  const ch = Math.floor((Math.min(SH, Math.ceil(Math.max(...path.map((p) => p.box.y + p.box.h)) + M)) - oy) / 2) * 2;
  path = path.map((p) => ({ ...p, box: { ...p.box, x: p.box.x - ox, y: p.box.y - oy } }));
  const F = path.map((p) => Math.round((p.t - s) * fps));
  // terms summed as a balanced tree: ffmpeg's expression parser fails ("Cannot allocate memory") on a flat a+b+c+... past
  // ~97 terms (measured, ffmpeg 8.1); (a+b)+(c+d) nests only log2(n) deep - checked up to 300 terms
  const sum = (t) => (t.length === 1 ? t[0] : `(${sum(t.slice(0, t.length >> 1))}+${sum(t.slice(t.length >> 1))})`);
  const expr = (g) => {
    const t = [`${g(path[0].box)}`];
    for (let k = 0; k + 1 < path.length; k++) {
      const d = +(g(path[k + 1].box) - g(path[k].box)).toFixed(2), L = Math.max(1, F[k + 1] - F[k]);
      if (d) t.push(path[k + 1].jump ? `${d}*gte(in-1,${F[k + 1]})` : `${d}*clip((in-1-${F[k]})/${L},0,1)`);   // a cut: on its frame
    }
    return `'${sum(t)}'`;
  };
  const X0 = (b) => b.x, X1 = (b) => b.x + b.w, Y0 = (b) => b.y, Y1 = (b) => b.y + b.h;
  return (Number.isFinite(SW) ? `crop=${cw}:${ch}:${ox}:${oy},` : '') + `perspective=x0=${expr(X0)}:y0=${expr(Y0)}:x1=${expr(X1)}:y1=${expr(Y0)}:x2=${expr(X0)}:y2=${expr(Y1)}:x3=${expr(X1)}:y3=${expr(Y1)}`
    + ':interpolation=cubic:eval=frame';
}
const FPS_DEFAULT = 60;

/* colour of a piece (dashboard user edit tab, 2026-10-02): brightness / contrast / saturation as 1 = unchanged. Same numbers
   as the extra-track clips in lib/render.mjs and the CSS filter of the preview (close, not identical: eq works on YUV). */
export function colorVf(c) {
  if (!c) return '';
  const ct = c.contrast ?? 1, sa = c.saturation ?? 1, br = c.brightness ?? 1, f = [];
  if (ct !== 1 || sa !== 1) f.push(`eq=contrast=${ct.toFixed(3)}:saturation=${sa.toFixed(3)}`);
  if (br !== 1) f.push(`format=gbrp,colorchannelmixer=rr=${br.toFixed(3)}:gg=${br.toFixed(3)}:bb=${br.toFixed(3)}`);
  const cv = curvesVf(c);                     // RGBW lift / gamma / gain + curves (2026-10-03), lib/color.mjs
  if (cv) f.push(cv);
  return f.length ? ',' + f.join(',') : '';
}
export { XFADE };   // transition names (dashboard) -> ffmpeg xfade, lib/trans.mjs

/* What scene.json needs from the body, without encoding anything (2026-10-02, `shortsmith preview`): the dashboard previews
   an edit straight from the light source copy (src_preview.mp4) and only the final render bakes window.mkv. Length = sum of
   the piece lengths the body would cut (a few ms off frame rounding), window height = the same formula as buildBody. */
export function estimateBody(projectDir, edit, preset, cutsList) {
  const C = edit.crop || { x: 0, y: 0, w: 1920, h: 1080 };
  const speed = edit.speed || 1;
  const W = preset.layout.window;
  const wh = W.h || Math.round(W.w * C.h / C.w / 2) * 2;
  let d = 0;
  for (const pc of cutsList) d += pc.gap ? pc.e - pc.s : (pc.e - pc.s) / (pc.source ? 1 : speed);
  return { duration: +d.toFixed(3), windowH: wh, crossfadeSec: edit.crossfadeSec ?? preset.audio?.crossfadeSec ?? 0, estimated: true };
}

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
  const cam = edit.camera?.keys?.length ? edit.camera.keys : null;
  let srcInfo = null;
  if (cam) {
    const [sw, sh, fr] = run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate', '-of', 'csv=p=0', src], 'probe size')
      .stdout.trim().split(',');
    const [fn, fd] = fr.split('/').map(Number);
    srcInfo = { w: +sw, h: +sh, fps: fn / (fd || 1) };
  }
  const sigs = {};
  const sigOf = (f) => (sigs[f] ??= sig(f));
  /* user move / zoom / rotate of a piece (dashboard user edit tab, 2026-10-03: "1차 편집 ... 화면을 1.5배 확대 하고 싶은데 1.6배
     확대 시킨 경우 변경 불가") - on top of the crop the edit chose. tfCropVf takes a new crop of the source (full source quality,
     the visible part of the crop at window aspect, zoomed about its centre, panned by x / y window px); where it leaves the
     source the source is padded black. tfPostVf does the same on a picture already at window size (camera path pieces).
     Same math as tfCrop in src/parts/Window.tsx. */
  const ev2 = (v) => Math.max(2, Math.round(v / 2) * 2);
  let SWH = null;
  const srcWH = () => {
    if (!SWH) { const [w, h] = run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', src], 'probe size').stdout.trim().split(','); SWH = { w: +w, h: +h }; }
    return SWH;
  };
  const tfOf = (pc) => {
    const t = pc && pc.tf;
    return t && (t.x || t.y || (t.z != null && Math.abs(t.z - 1) > 1e-4) || t.r) ? { x: 0, y: 0, z: 1, r: 0, ...t } : null;
  };
  const tfRot = (tf) => (tf.r ? `,rotate=${(tf.r * Math.PI / 180).toFixed(6)}:fillcolor=black` : '');
  const tfCropVf = (c, tf) => {
    const { w: SW, h: SH } = srcWH(), A = W.w / wh;
    const V = c.w / c.h > A ? { w: c.h * A, h: c.h } : { w: c.w, h: c.w / A };
    const vx = c.x + (c.w - V.w) / 2, vy = c.y + (c.h - V.h) / 2, s = V.w / W.w, z = Math.max(0.05, tf.z);
    const nw = V.w / z, nh = V.h / z, nx = vx + V.w / 2 - tf.x * s / z - nw / 2, ny = vy + V.h / 2 - tf.y * s / z - nh / 2;
    const need = Math.max(0, -nx, -ny, nx + nw - SW, ny + nh - SH), M = need > 0 ? ev2(need + 2) : 0;
    return (M ? `pad=${SW + 2 * M}:${SH + 2 * M}:${M}:${M}:black,` : '')
      + `crop=${ev2(nw)}:${ev2(nh)}:${Math.round(nx + M)}:${Math.round(ny + M)},scale=${W.w}:${wh}:flags=lanczos,setsar=1`;
  };
  const tfPostVf = (tf) => {
    const z = Math.max(0.05, tf.z), sw = ev2(W.w * z), sh = ev2(wh * z);
    const x0 = (sw - W.w) / 2 - tf.x, y0 = (sh - wh) / 2 - tf.y;
    const need = Math.max(0, -x0, -y0, x0 + W.w - sw, y0 + wh - sh), P = need > 0 ? ev2(need + 2) : 0;
    return `,scale=${sw}:${sh}:flags=lanczos` + (P ? `,pad=${sw + 2 * P}:${sh + 2 * P}:${P}:${P}:black` : '')
      + `,crop=${W.w}:${wh}:${Math.round(x0 + P)}:${Math.round(y0 + P)},setsar=1`;
  };

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
    const gain = pc.ahide ? 'volume=0,' : gainDb ? `volume=${gainDb}dB,` : '';   // ahide: the sound went to a lower track (dashboard)
    const pcC = pc.crop || (pc.source ? null : C);
    // start_time=0: a source missing the frame right at the cut (260921 합본 38.200s, a seam of joined files) would start at
    // 1/60s, and fps= began there - the piece came out a frame short and the picture ran 17ms ahead of the sound after it
    const tail = (sp !== 1 ? `,setpts=(PTS-STARTPTS)/${sp}` : '') + `,fps=${fps}:start_time=0,format=nv12`;
    // a piece's own crop may have another aspect: fill the window, trimming the excess (no stretching)
    const tf = tfOf(pc);
    // vhide: the picture went to an upper track (dashboard user edit tab, 2026-10-03) - the piece keeps its sound, the window goes black
    const hideVf = pc.vhide ? ',drawbox=x=0:y=0:w=iw:h=ih:color=black:t=fill' : '';
    const cropVf = (c) => (tf ? tfCropVf(c || { x: 0, y: 0, w: srcWH().w, h: srcWH().h }, tf) + tfRot(tf)
      : `${c ? `crop=${c.w}:${c.h}:${c.x}:${c.y},` : ''}scale=${W.w}:${wh}:force_original_aspect_ratio=increase:flags=lanczos,crop=${W.w}:${wh},setsar=1`)
      + colorVf(pc.color) + hideVf + tail;
    // camera: split the piece where the box holds / moves; only the piece's own ends get the audio fade (music runs on)
    // camera spans: about a third of the piece each (+1s so no sliver is left over), so the three encoders below all have work
    const spans = cam && !pc.source && !pc.crop ? cameraSpans(cam, pc.s, pc.e, W.w / wh, srcInfo.w, srcInfo.h, srcInfo.fps,
      Math.max(4, (pc.e - pc.s) / 3 + 1)) : [{ s: pc.s, e: pc.e }];
    let off = 0;
    spans.forEach((q, qi) => {
      // camera pieces fall on any 1/30s: cut them by frame count, not by a 3-decimal -t - 18 pieces came out 1797 frames for
      // 30.000s of sound (a frame short or long each), so the picture ended 50ms behind the audio
      const exact = spans.length > 1;
      const qd = exact ? q.e - q.s : +(q.e - q.s).toFixed(3);
      const qo = qi === spans.length - 1 ? +(outDur - off).toFixed(exact ? 6 : 3) : exact ? Math.round(qd / sp * fps) / fps : +(qd / sp).toFixed(3);
      const nv = Math.round(qo * fps);
      let vf;
      // fps first: the path counts input frames (in), and an OBS recording drops one now and then - 허니하트 18.807s lost a
      // frame and the rest of an 8.8s span was drawn a frame late (up to 8px on a moving close-up). Regular frames, regular count.
      if (q.path) vf = `fps=${srcInfo.fps}:start_time=0,` + pathVf(q.path, q.s, srcInfo.fps, srcInfo.w, srcInfo.h) + `,scale=${W.w}:${wh}:flags=lanczos,setsar=1`
        + (tf ? tfPostVf(tf) + tfRot(tf) : '') + colorVf(pc.color) + hideVf + tail;
      else vf = cropVf(q.from || pcC);
      const fi = qi === 0 ? `afade=t=in:st=0:d=${fade},` : '', fo = qi === spans.length - 1 ? `,afade=t=out:st=${Math.max(0, qo - fade).toFixed(3)}:d=${fade}` : '';
      const af = `${gain}${sp !== 1 ? `atempo=${sp},` : ''}aresample=48000${fi ? ',' + fi.slice(0, -1) : ''}${fo}`;
      const key = md5([VERSION, sigOf(file), q.s, qd, vf, af, enc.name, ...(exact ? [nv] : [])]);
      const out = path.join(cache, `win_${key}.mkv`);
      if (!fs.existsSync(out)) {
        // a long camera path is longer than the Windows command line (32K): ffmpeg reads it from a file (-/vf, ffmpeg 7.1+)
        let vfArg = ['-vf', vf];
        if (vf.length > 4000) {
          const vfFile = path.join(cache, `vf_${key}.txt`);
          fs.writeFileSync(vfFile, vf);
          vfArg = ['-/vf', vfFile];
        }
        jobs.push(['-y', '-v', 'error', '-ss', q.s.toFixed(exact ? 6 : 3), '-t', (exact ? qd + 0.1 : qd).toFixed(exact ? 6 : 3), '-i', file,
          ...vfArg, '-af', af, ...(exact ? ['-frames:v', String(nv)] : []), '-t', qo.toFixed(exact ? 6 : 3), ...enc.args,
          '-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '2', out + '.tmp.mkv']);
        fresh++;
      } else fs.utimesSync(out, new Date(), new Date());
      clips.push(out);
      keys.push([key, +(cur + off).toFixed(3), qo]);
      off += qo;
    });
    parts.push({ file, s: pc.s, e: pc.e, sp, gain, at: cur, outDur, pc, vf0: cropVf(pcC), cam: !!(cam && !pc.source && !pc.crop), tail });
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
  /* Transitions between pieces (dashboard user edit tab, 2026-10-02): centered on the cut and made from the source beyond each
     piece's ends (the handles), so the length and every caption time stay the same. Each one is a small patch at window size -
     A from its out point -h..+h and B from its in point -h..+h, joined by ffmpeg xfade - that render.mjs lays over window.mkv.
     With a camera path (dance, 2026-10-03) each side's handle follows the camera over its own source seconds, the same path
     the pieces are drawn with - so the patch moves like the shots around it. */
  const transitions = [];
  const srcLen = duration(src);
  for (let i = 1; i < parts.length; i++) {
    const A = parts[i - 1], B = parts[i], t = B.pc.tin;
    if (!t || !t.d || A.pc.gap || B.pc.gap || A.pc.source || B.pc.source || A.sp !== 1) continue;
    if (Math.abs(A.at + A.outDur - B.at) > 0.01) continue;          // a gap (ripple off) sits between them
    const h = Math.min(t.d / 2, B.s, srcLen - A.e - 0.05, A.outDur / 2, B.outDur / 2);
    if (h < 1 / fps) continue;
    const d = Math.round(2 * h * fps) / fps;
    const camVf = (P, s0) => {                    // the camera's path over [s0, s0 + d] of the source, as the pieces draw it
      const q = cameraSpans(cam, s0, s0 + d + 1 / srcInfo.fps, W.w / wh, srcInfo.w, srcInfo.h, srcInfo.fps, 1e9)[0];
      return `fps=${srcInfo.fps}:start_time=0,` + pathVf(q.path, q.s, srcInfo.fps, srcInfo.w, srcInfo.h)
        + `,scale=${W.w}:${wh}:flags=lanczos,setsar=1` + (tfOf(P.pc) ? tfPostVf(tfOf(P.pc)) + tfRot(tfOf(P.pc)) : '') + colorVf(P.pc.color) + P.tail;
    };
    const vfA = A.cam ? camVf(A, +(A.e - d / 2).toFixed(4)) : A.vf0, vfB = B.cam ? camVf(B, +(B.s - d / 2).toFixed(4)) : B.vf0;
    const fc = `[0:v]${vfA}[a];[1:v]${vfB}[b];[a][b]xfade=transition=${XFADE[t.type] || 'fade'}:duration=${d.toFixed(4)}:offset=0,format=nv12[v]`;
    const key = md5([VERSION, 'xfade', sigOf(src), A.e, B.s, d, fc, enc.name]);
    const out = path.join(cache, `tr_${key}.mkv`);
    if (!fs.existsSync(out)) {
      jobs.push(['-y', '-v', 'error', '-ss', (A.e - d / 2).toFixed(4), '-t', (d + 0.1).toFixed(4), '-i', src,
        '-ss', (B.s - d / 2).toFixed(4), '-t', (d + 0.1).toFixed(4), '-i', src,
        '-filter_complex', fc, '-map', '[v]', '-frames:v', String(Math.round(d * fps)), '-an', ...enc.args, out + '.tmp.mkv']);
      fresh++;
    } else fs.utimesSync(out, new Date(), new Date());
    transitions.push({ at: +(B.at - d / 2).toFixed(4), d: +d.toFixed(4), type: t.type, file: path.basename(out), key });
  }
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
    const black = path.join(cache, `black_${bgKey}.mp4`);          // cached: it cost 6s on every body run (1080x1920 60fps, qsv)
    if (!fs.existsSync(black)) {
      run('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', `color=black:s=${preset.canvas.width}x${preset.canvas.height}:r=${fps}`,
        '-t', (d + 1).toFixed(3), '-vf', 'format=nv12', ...enc.args, black], 'black background');
    }
    fs.copyFileSync(black, bgOut);
  }

  const old = Date.now() - 7 * 86400e3;
  for (const n of fs.readdirSync(cache)) {
    const p = path.join(cache, n);
    if (/^(win|bgp?|black|vf|tr)_/.test(n) && fs.statSync(p).mtimeMs < old) fs.rmSync(p);
  }
  const body = { duration: +d.toFixed(3), mainDuration: +mainDur.toFixed(3), windowH: wh, bg: bgKey, encoder: enc.name, pieces: keys, crossfadeSec: edit.crossfadeSec ?? preset.audio?.crossfadeSec ?? 0,
    ...(transitions.length ? { transitions } : {}) };
  writeJson(path.join(projectDir, 'body.json'), body);
  log(`body: ${clips.length} pieces (${fresh} new, ${enc.name}) · window.mkv ${d.toFixed(2)}s · window ${W.w}x${wh}`);
  return body;
}

export { slash };
