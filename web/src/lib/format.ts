export function fmtDuration(seconds: number | null | undefined): string {
  if (!seconds || !isFinite(seconds)) return '--:--';
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export function fmtLongDuration(seconds: number | null | undefined): string {
  if (!seconds) return '0 分钟';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h > 0) return `${h} 小时 ${m} 分钟`;
  return `${m} 分钟`;
}

export function fmtBitrate(bps: number | null): string {
  if (!bps) return '';
  return `${Math.round(bps / 1000)} kbps`;
}

export function fmtSampleRate(hz: number | null): string {
  if (!hz) return '';
  return `${(hz / 1000).toFixed(hz % 1000 === 0 ? 0 : 1)} kHz`;
}

export function fmtFileSize(bytes: number | null | undefined): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export function qualityLabel(t: {
  lossless?: number | boolean;
  bit_depth?: number | null;
  sample_rate?: number | null;
  codec?: string | null;
  bitrate?: number | null;
}): string {
  const ls = t.lossless ? 1 : 0;
  if (ls && t.bit_depth && t.sample_rate) {
    return `${t.bit_depth}/${(t.sample_rate / 1000).toFixed(t.sample_rate % 1000 === 0 ? 0 : 1)}`;
  }
  if (ls && t.codec) return t.codec.toUpperCase();
  if (t.bitrate) return `${Math.round(t.bitrate / 1000)} kbps`;
  return t.codec ?? '';
}
