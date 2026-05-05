export interface LrcLine {
  time: number;
  text: string;
}

export function parseLrc(content: string): LrcLine[] {
  const lines: LrcLine[] = [];
  const reTime = /\[(\d+):(\d+(?:\.\d+)?)\]/g;
  for (const raw of content.split(/\r?\n/)) {
    const text = raw.replace(/\[(\d+):(\d+(?:\.\d+)?)\]/g, '').trim();
    let m: RegExpExecArray | null;
    reTime.lastIndex = 0;
    const stamps: number[] = [];
    while ((m = reTime.exec(raw)) !== null) {
      const min = Number(m[1]);
      const sec = Number(m[2]);
      stamps.push(min * 60 + sec);
    }
    for (const s of stamps) {
      lines.push({ time: s, text });
    }
  }
  lines.sort((a, b) => a.time - b.time);
  return lines;
}

export function activeLrcIndex(lines: LrcLine[], t: number): number {
  let lo = 0, hi = lines.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].time <= t) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}
