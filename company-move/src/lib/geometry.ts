import type { Point } from '@/types';

export const cen = (pts: Point[]): Point => [
  pts.reduce((a, q) => a + q[0], 0) / pts.length,
  pts.reduce((a, q) => a + q[1], 0) / pts.length,
];

export const bbox = (pts: Point[]): Point => {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
};

export function segD(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const L = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

export function inPoly(p: Point, v: Point[]): boolean {
  let c = false;
  for (let i = 0, j = v.length - 1; i < v.length; j = i++) {
    if (
      v[i][1] > p[1] !== v[j][1] > p[1] &&
      p[0] < ((v[j][0] - v[i][0]) * (p[1] - v[i][1])) / (v[j][1] - v[i][1]) + v[i][0]
    )
      c = !c;
  }
  return c;
}

// Ramer–Douglas–Peucker simplification
export function rdp(p: Point[], e: number): Point[] {
  if (p.length < 3) return p;
  const a = p[0];
  const b = p[p.length - 1];
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const L = Math.hypot(dx, dy) || 1;
  let md = 0;
  let mi = 0;
  for (let i = 1; i < p.length - 1; i++) {
    const d = Math.abs(dy * p[i][0] - dx * p[i][1] + b[0] * a[1] - b[1] * a[0]) / L;
    if (d > md) {
      md = d;
      mi = i;
    }
  }
  return md > e
    ? rdp(p.slice(0, mi + 1), e).slice(0, -1).concat(rdp(p.slice(mi), e))
    : [a, b];
}

export function smooth(p: Point[]): Point[] {
  let out = p;
  for (let n = 0; n < 2; n++) {
    const o: Point[] = [out[0]];
    for (let i = 0; i < out.length - 1; i++) {
      const a = out[i];
      const b = out[i + 1];
      o.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]]);
      o.push([0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
    }
    o.push(out[out.length - 1]);
    out = o;
  }
  return out;
}

export function lum(h: string): number {
  const n = parseInt(h.slice(1), 16);
  const r = n >> 16;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

export function rotatePts(pts: Point[], c: Point, ang: number): Point[] {
  const cs = Math.cos(ang);
  const sn = Math.sin(ang);
  return pts.map(
    (q): Point => [
      c[0] + (q[0] - c[0]) * cs - (q[1] - c[1]) * sn,
      c[1] + (q[0] - c[0]) * sn + (q[1] - c[1]) * cs,
    ]
  );
}

// rect resize handle config
export const RS = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
  { y: 0 },
  { x: 1 },
  { y: 1 },
  { x: 0 },
];

export function rectHandles(it: { pts: Point[] }): Point[] {
  const P = it.pts;
  const h: Point[] = P.map((q) => [q[0], q[1]]);
  for (let i = 0; i < 4; i++) {
    const a = P[i];
    const b = P[(i + 1) % 4];
    h.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
  }
  return h;
}

export function rotHandle(it: { pts: Point[]; rot?: number } | null, K: number): Point | null {
  if (!it) return null;
  const c = cen(it.pts);
  const r = Math.max(...it.pts.map((q) => Math.hypot(q[0] - c[0], q[1] - c[1]))) + 46 * K;
  const a = it.rot || 0;
  return [c[0] + Math.sin(a) * r, c[1] - Math.cos(a) * r];
}
