import { spawnSync } from 'node:child_process';

/* Pick the fastest H.264 encoder that actually works on this machine. Listing encoders is not enough:
   ffmpeg builds list nvenc/qsv/amf even without the GPU, so each candidate encodes a few test frames.
   Measured on an Intel Arc A350M laptop: 1080x1920 60fps 10s, libx264 medium 36s vs h264_qsv 16s.
   Override with SHORTSMITH_ENCODER=h264_nvenc|h264_qsv|h264_amf|h264_videotoolbox|libx264. */
const CANDIDATES = {
  h264_nvenc: ['-c:v', 'h264_nvenc', '-preset', 'p5', '-rc', 'vbr', '-cq', '20', '-b:v', '0'],
  h264_qsv: ['-c:v', 'h264_qsv', '-global_quality', '20'],
  h264_amf: ['-c:v', 'h264_amf', '-rc', 'cqp', '-qp_i', '20', '-qp_p', '22'],
  h264_videotoolbox: ['-c:v', 'h264_videotoolbox', '-q:v', '65'],
  libx264: ['-c:v', 'libx264', '-preset', 'medium', '-crf', '18'],
};

let cached = null;

/* Final encode chosen in the dashboard render tab (2026-10-03): codec (h264 | hevc), software or hardware first, quality q
   (CRF-like, lower = better, 20 = what the chunks use). Each encoder gets its own quality knob; hevc in mp4 gets the hvc1 tag
   so Apple players open it. Probed like encoder() - a listed encoder is not a working one. */
const OUT = {
  h264: { hw: ['h264_nvenc', 'h264_qsv', 'h264_amf', 'h264_videotoolbox'], sw: 'libx264' },
  hevc: { hw: ['hevc_nvenc', 'hevc_qsv', 'hevc_amf', 'hevc_videotoolbox'], sw: 'libx265' },
};
function qArgs(name, q) {
  if (/nvenc/.test(name)) return ['-c:v', name, '-preset', 'p5', '-rc', 'vbr', '-cq', String(q), '-b:v', '0'];
  if (/qsv/.test(name)) return ['-c:v', name, '-global_quality', String(q)];
  if (/amf/.test(name)) return ['-c:v', name, '-rc', 'cqp', '-qp_i', String(q), '-qp_p', String(q + 2)];
  if (/videotoolbox/.test(name)) return ['-c:v', name, '-q:v', String(Math.max(1, Math.min(100, Math.round(100 - q * 2.2))))];
  if (name === 'libx265') return ['-c:v', name, '-preset', 'medium', '-crf', String(q)];
  return ['-c:v', name, '-preset', 'slow', '-crf', String(q)];
}
const outOk = {};
export function outputEncoder({ codec = 'h264', soft = false, q = 20 } = {}) {
  const C = OUT[codec] || OUT.h264, order = soft ? [C.sw] : [...C.hw, C.sw];
  for (const name of order) {
    const pix = /^lib/.test(name) ? 'yuv420p' : 'nv12', args = [...qArgs(name, q), '-pix_fmt', pix];
    if (outOk[name] === undefined) {
      outOk[name] = spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=1080x1920:r=30', '-frames:v', '5',
        '-vf', `format=${pix}`, ...args, '-f', 'null', '-'], { encoding: 'utf8', timeout: 30000 }).status === 0;
    }
    if (outOk[name]) return { name, args: [...args, ...(codec === 'hevc' ? ['-tag:v', 'hvc1'] : []), '-g', '120'] };
  }
  throw new Error(`no working ${codec} encoder`);
}

function works(name) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=1080x1920:r=60', '-frames:v', '10',
    '-vf', 'format=nv12', ...CANDIDATES[name], '-f', 'null', '-'], { encoding: 'utf8', timeout: 30000 });
  return r.status === 0;
}

export function encoder() {
  if (cached) return cached;
  const want = process.env.SHORTSMITH_ENCODER;
  const order = want ? [want] : ['h264_nvenc', 'h264_qsv', 'h264_amf', 'h264_videotoolbox', 'libx264'];
  for (const name of order) {
    if (CANDIDATES[name] && works(name)) {
      cached = { name, args: [...CANDIDATES[name], '-pix_fmt', name === 'libx264' ? 'yuv420p' : 'nv12', '-g', '120'] };
      return cached;
    }
  }
  throw new Error('no working H.264 encoder (is ffmpeg installed?)');
}
