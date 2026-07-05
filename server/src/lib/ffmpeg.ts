import { spawnSync } from 'node:child_process';

// Resolved once at module load: LUMEN_FFMPEG wins if set, otherwise probe
// PATH. null means no usable ffmpeg — transcoding and cover resizing degrade
// to serving the original files.
function resolveFfmpeg(): string | null {
  const works = (bin: string) => {
    const probe = spawnSync(bin, ['-version'], { stdio: 'ignore' });
    return !probe.error && probe.status === 0;
  };
  const explicit = process.env.LUMEN_FFMPEG;
  if (explicit) {
    // Probe the explicit path too — advertising transcoding for a typo'd
    // binary would make every ?quality= request fail asynchronously (spawn
    // ENOENT is an event, not a throw) instead of falling back to raw bytes.
    if (works(explicit)) return explicit;
    console.warn(`LUMEN_FFMPEG="${explicit}" is not runnable — ignoring it`);
  }
  return works('ffmpeg') ? 'ffmpeg' : null;
}

export const ffmpegPath: string | null = resolveFfmpeg();

export function hasFfmpeg(): boolean {
  return ffmpegPath !== null;
}

console.log(
  ffmpegPath
    ? `ffmpeg available at "${ffmpegPath}" — transcoding enabled`
    : 'ffmpeg not found — transcoding disabled (install ffmpeg or set LUMEN_FFMPEG)'
);
