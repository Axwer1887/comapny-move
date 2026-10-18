import type { EnhanceOpts } from '@/types';

export interface BuildResult {
  canvas: HTMLCanvasElement;
  newW: number;
}

export function buildEnhanced(
  orig: HTMLImageElement,
  opts: EnhanceOpts,
  currentW: number
): BuildResult {
  const w = Math.round(Math.min(orig.naturalWidth * (opts.eUp ? 2 : 1), 3600));
  const h = Math.round((w * orig.naturalHeight) / orig.naturalWidth);
  const b = document.createElement('canvas');
  b.width = w;
  b.height = h;
  const c = b.getContext('2d')!;
  c.imageSmoothingQuality = 'high';
  c.filter = `contrast(${opts.eCo}%) saturate(${opts.eSa}%) brightness(${opts.eBr}%)`;
  c.drawImage(orig, 0, 0, w, h);
  c.filter = 'none';

  const a = (opts.eSh / 100) * 1.2;
  if (a > 0) {
    const d = c.getImageData(0, 0, w, h);
    const s = d.data;
    const o = new Uint8ClampedArray(s);
    const st = w * 4;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * st + x * 4;
        for (let q = 0; q < 3; q++) {
          const j = i + q;
          o[j] = s[j] * (1 + 4 * a) - a * (s[j - 4] + s[j + 4] + s[j - st] + s[j + st]);
        }
      }
    }
    d.data.set(o);
    c.putImageData(d, 0, 0);
  }
  void currentW;
  return { canvas: b, newW: w };
}
