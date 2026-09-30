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
