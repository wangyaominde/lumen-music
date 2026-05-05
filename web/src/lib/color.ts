// Lightweight cover-color extraction. Downsamples to 32x32 and picks
// the average of saturated, dark-balanced pixels.
export interface Palette {
  primary: [number, number, number];
  secondary: [number, number, number];
  fg: [number, number, number];
}

const cache = new Map<string, Palette>();

export async function extractPalette(src: string): Promise<Palette> {
  if (cache.has(src)) return cache.get(src)!;

  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.decoding = 'async';
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('image load failed'));
    img.src = src;
  });

  const N = 48;
  const canvas = document.createElement('canvas');
  canvas.width = N;
  canvas.height = N;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('no 2d ctx');
  ctx.drawImage(img, 0, 0, N, N);
  const { data } = ctx.getImageData(0, 0, N, N);

  // Bin colors by quantized HSL
  const buckets = new Map<string, { r: number; g: number; b: number; count: number; sat: number; light: number }>();

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
    if (a < 200) continue;
    const [h, s, l] = rgbToHsl(r, g, b);
    if (l < 0.06 || l > 0.96) continue;
    if (s < 0.18) continue;
    const key = `${Math.round(h * 12)}-${Math.round(s * 6)}-${Math.round(l * 6)}`;
    let b1 = buckets.get(key);
    if (!b1) {
      b1 = { r: 0, g: 0, b: 0, count: 0, sat: 0, light: 0 };
      buckets.set(key, b1);
    }
    b1.r += r; b1.g += g; b1.b += b;
    b1.sat += s; b1.light += l;
    b1.count++;
  }

  const list = [...buckets.values()].map(b1 => ({
    r: Math.round(b1.r / b1.count),
    g: Math.round(b1.g / b1.count),
    b: Math.round(b1.b / b1.count),
    weight: b1.count * (0.5 + b1.sat / b1.count) * (1 - Math.abs(0.55 - b1.light / b1.count))
  }));
  list.sort((a, b) => b.weight - a.weight);

  let primary: [number, number, number] = [120, 100, 200];
  let secondary: [number, number, number] = [60, 40, 100];
  if (list[0]) primary = [list[0].r, list[0].g, list[0].b];
  if (list[1]) secondary = [list[1].r, list[1].g, list[1].b];
  else if (list[0]) {
    secondary = [
      Math.round(list[0].r * 0.5),
      Math.round(list[0].g * 0.5),
      Math.round(list[0].b * 0.5)
    ];
  }
  const fg: [number, number, number] = luminance(primary[0], primary[1], primary[2]) > 0.55 ? [10, 10, 14] : [240, 240, 248];
  const palette: Palette = { primary, secondary, fg };
  cache.set(src, palette);
  return palette;
}

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return [h, s, l];
}

function luminance(r: number, g: number, b: number): number {
  const a = [r, g, b].map(v => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
}

export function rgba(c: [number, number, number], a = 1): string {
  return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;
}
