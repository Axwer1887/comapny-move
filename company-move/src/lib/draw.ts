import type { MapItem, Note, Panels, Point, ZoneType } from '@/types';
import { dt, t as tr } from '@/lib/i18n';
import { bbox, cen, lum, rectHandles, rotHandle, segD, inPoly } from './geometry';
import { PATH_COLOR } from './defaults';

const FONT = 'Inter,"Segoe UI",Arial,sans-serif';

export interface RenderCtx {
  ctx: CanvasRenderingContext2D;
  cvW: number;
  cvH: number;
  base: CanvasImageSource | null;
  googleMapActive?: boolean;
  types: ZoneType[];
  items: MapItem[];
  title: string;
  sub: string;
  notes: Note[];
  panels: Panels;
  opts: {
    oLegend: boolean;
    oNorth: boolean;
    oScale: boolean;
    oLabels: boolean;
    oFill: boolean;
    aT: number;
    aL: number;
  };
  mpp: number | null;
  tool: string;
  sel: number;
  cur: Point[];
  mouse: Point | null;
  drag: Point | null;
  selItem: MapItem | null;
  tCol: string;
  zoom: number;
  pan: { x: number; y: number };
  /**
   * Live, not yet frozen Google map: the title board, north arrow and scale
   * bar are left off and appear once the map is locked.
   */
  liveMap?: boolean;
  /** Device pixels per logical unit of the target canvas. */
  pixelRatio?: number;
  /** Export-only footer ("project · sheet · date"); null while editing. */
  meta?: string | null;
}

/**
 * Pre-scaled copies (halving steps) of a large background, made once and
 * reused: downscaling a 4000 px image with high quality on every frame is
 * what made editing on big sketches sluggish.
 */
const mipCache = new WeakMap<object, CanvasImageSource[]>();
function baseForSize(base: CanvasImageSource, targetW: number): CanvasImageSource {
  const bw = (base as HTMLCanvasElement).width;
  if (!bw || targetW >= bw * 0.6) return base;
  let levels = mipCache.get(base as object);
  if (!levels) {
    levels = [base];
    mipCache.set(base as object, levels);
  }
  let i = 0;
  for (;;) {
    const cur = levels[i] as HTMLCanvasElement;
    if (cur.width / 2 < targetW || cur.width < 128) return cur;
    if (!levels[i + 1]) {
      const c = document.createElement('canvas');
      c.width = Math.round(cur.width / 2);
      c.height = Math.round(cur.height / 2);
      const x = c.getContext('2d');
      if (!x) return cur;
      x.imageSmoothingQuality = 'high';
      x.drawImage(cur, 0, 0, c.width, c.height);
      levels[i + 1] = c;
    }
    i++;
  }
}

/**
 * The background as it appears on screen (zoom/pan applied, device size),
 * cached until the view changes. While drawing or dragging, each frame then
 * only copies this bitmap 1:1 instead of resampling the large image.
 */
let viewCache: { key: string; base: CanvasImageSource; canvas: HTMLCanvasElement } | null = null;
function drawBaseCached(R: RenderCtx) {
  const { ctx } = R;
  const out = ctx.canvas;
  const pr = R.pixelRatio || 1;
  const key = `${out.width}x${out.height}|${pr}|${R.zoom}|${R.pan.x}|${R.pan.y}|${R.cvW}x${R.cvH}`;
  if (!viewCache || viewCache.base !== R.base || viewCache.key !== key) {
    const c = viewCache?.canvas.width === out.width && viewCache.canvas.height === out.height ? viewCache.canvas : document.createElement('canvas');
    c.width = out.width;
    c.height = out.height;
    const x = c.getContext('2d');
    if (!x || !R.base) return;
    x.setTransform(pr * R.zoom, 0, 0, pr * R.zoom, pr * R.pan.x, pr * R.pan.y);
    x.imageSmoothingQuality = 'high';
    x.drawImage(baseForSize(R.base, R.cvW * pr * R.zoom), 0, 0, R.cvW, R.cvH);
    viewCache = { key, base: R.base, canvas: c };
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(viewCache.canvas, 0, 0);
  ctx.restore();
}

/** Is the background image mostly light? Cached per image (cheap 12×12 sample). */
const lightCache = new WeakMap<object, boolean>();
function isLightBackground(base: CanvasImageSource | null): boolean {
  if (!base) return false;
  const hit = lightCache.get(base as object);
  if (hit !== undefined) return hit;
  let light = false;
  try {
    const c = document.createElement('canvas');
    c.width = 12;
    c.height = 12;
    const x = c.getContext('2d');
    if (x) {
      x.drawImage(base, 0, 0, 12, 12);
      const d = x.getImageData(0, 0, 12, 12).data;
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      light = sum / (d.length / 4) / 255 > 0.6;
    }
  } catch {
    /* tainted / unavailable: assume dark */
  }
  lightCache.set(base as object, light);
  return light;
}

export function typeById(types: ZoneType[], id?: number): ZoneType {
  return types.find((t) => t.id === id) || types[0];
}

/** "#rrggbb" + alpha → rgba(); falls back to the given default colour. */
export function hexA(hex: string | undefined, a: number, fallback = '#ffffff'): string {
  const m = (hex || fallback).match(/^#?([0-9a-f]{6})$/i) || fallback.match(/^#?([0-9a-f]{6})$/i);
  const h = m ? m[1] : 'ffffff';
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
}

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (ctx as any).roundRect(x, y, w, h, r);
}

function pill(
  ctx: CanvasRenderingContext2D,
  txt: string,
  x: number,
  y: number,
  bg: string,
  fg: string,
  fs: number,
  K: number,
  center = true
): [number, number] {
  ctx.font = `700 ${fs * K}px ${FONT}`;
  const w = ctx.measureText(txt).width + 22 * K;
  const h = fs * K * 1.9;
  const px = center ? x - w / 2 : x;
  const py = center ? y - h / 2 : y;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.35)';
  ctx.shadowBlur = 8 * K;
  ctx.shadowOffsetY = 2 * K;
  ctx.fillStyle = bg;
  rr(ctx, px, py, w, h, 6 * K);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = fg;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(txt, px + 11 * K, py + h / 2 + 1 * K);
  return [w, h];
}

/**
 * Map label for a zone: a dark card with a pin badge in the category colour,
 * the element's name and an optional second line (address or category).
 * A custom label colour (lbg / fg) from the zone type overrides the card.
 */
function zoneLabel(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  title: string,
  subtitle: string,
  color: string,
  lbg: string | undefined,
  fg: string | undefined,
  K: number
) {
  const bg = lbg || '#111b25';
  const light = lum(bg) > 0.6;
  const tc = fg || (light ? '#17212f' : '#f8fafc');
  const sc = fg ? hexA(fg, 0.75) : light ? '#64748b' : '#b6c2d0';
  const fs = 17 * K;
  const fs2 = 13 * K;
  ctx.save();
  ctx.font = `700 ${fs}px ${FONT}`;
  const w1 = ctx.measureText(title).width;
  ctx.font = `500 ${fs2}px ${FONT}`;
  const w2 = subtitle ? ctx.measureText(subtitle).width : 0;
  const pin = 30 * K;
  const padX = 10 * K;
  const h = subtitle ? 52 * K : 38 * K;
  const w = pin + padX * 2.2 + Math.max(w1, w2);
  const x = cx - w / 2;
  const y = cy - h / 2;
  ctx.shadowColor = 'rgba(0,0,0,.35)';
  ctx.shadowBlur = 10 * K;
  ctx.shadowOffsetY = 3 * K;
  ctx.fillStyle = lbg ? bg : hexA(bg, 0.92);
  rr(ctx, x, y, w, h, 7 * K);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5 * K;
  rr(ctx, x, y, w, h, 7 * K);
  ctx.stroke();
  // pin badge
  const px = x + padX + pin / 2 - 2 * K;
  const py = cy;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(px, py, pin / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(px, py, pin / 5.5, 0, Math.PI * 2);
  ctx.fill();
  // text
  const tx = x + padX * 1.6 + pin;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = tc;
  ctx.font = `700 ${fs}px ${FONT}`;
  ctx.fillText(title, tx, subtitle ? y + 22 * K : cy + fs * 0.36);
  if (subtitle) {
    ctx.fillStyle = sc;
    ctx.font = `500 ${fs2}px ${FONT}`;
    ctx.fillText(subtitle, tx, y + 41 * K);
  }
  ctx.restore();
}

function arrowHead(
  ctx: CanvasRenderingContext2D,
  a: Point,
  b: Point,
  col: string,
  size: number
) {
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.moveTo(b[0], b[1]);
  ctx.lineTo(b[0] - size * Math.cos(ang - 0.45), b[1] - size * Math.sin(ang - 0.45));
  ctx.lineTo(b[0] - size * Math.cos(ang + 0.45), b[1] - size * Math.sin(ang + 0.45));
  ctx.closePath();
  ctx.fill();
}

function polyPath(ctx: CanvasRenderingContext2D, pts: Point[], close: boolean) {
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
  if (close) ctx.closePath();
}

function drawPoly(
  R: RenderCtx,
  pts: Point[],
  col: string,
  close = true,
  prev = false
) {
  const { ctx } = R;
  const K = R.cvW / 1500;
  if (pts.length < 2) return;
  ctx.save();
  ctx.lineJoin = 'miter';
  if (close && R.opts.oFill) {
    polyPath(ctx, pts, true);
    ctx.fillStyle = col + '30';
    ctx.fill();
  }
  polyPath(ctx, pts, close);
  ctx.strokeStyle = 'rgba(0,0,0,.35)';
  ctx.lineWidth = 9 * K;
  ctx.stroke();
  polyPath(ctx, pts, close);
  ctx.strokeStyle = col;
  ctx.lineWidth = 6 * K;
  if (prev) ctx.setLineDash([12 * K, 8 * K]);
  ctx.stroke();
  ctx.restore();
}

function drawPath(R: RenderCtx, pts: Point[], prev = false) {
  const { ctx } = R;
  const K = R.cvW / 1500;
  if (pts.length < 2) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  polyPath(ctx, pts, false);
  ctx.strokeStyle = 'rgba(8,20,32,.55)';
  ctx.lineWidth = 9 * K;
  ctx.stroke();
  polyPath(ctx, pts, false);
  ctx.strokeStyle = PATH_COLOR;
  ctx.lineWidth = 5 * K;
  ctx.setLineDash([16 * K, 10 * K]);
  ctx.stroke();
  ctx.setLineDash([]);
  if (!prev) {
    const a = pts[pts.length - 2];
    const b = pts[pts.length - 1];
    arrowHead(ctx, a, b, PATH_COLOR, 22 * K);
  }
  ctx.restore();
}

function drawEntrance(
  R: RenderCtx,
  a: Point,
  b: Point,
  col = '#ff8a00',
  txt = 'BEJÁRAT',
  fg?: string
) {
  const { ctx } = R;
  const K = R.cvW / 1500;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(a[0], a[1]);
  ctx.lineTo(b[0], b[1]);
  ctx.strokeStyle = 'rgba(0,0,0,.4)';
  ctx.lineWidth = 11 * K;
  ctx.stroke();
  ctx.strokeStyle = col;
  ctx.lineWidth = 7 * K;
  ctx.stroke();
  arrowHead(ctx, a, b, col, 30 * K);
  ctx.restore();
  if (txt) pill(ctx, txt, a[0], a[1] - 34 * K, col, fg || (lum(col) > 0.6 ? '#111' : '#fff'), 17, K);
}

export function hitTestItem(items: MapItem[], p: Point, K: number): MapItem | null {
  return [...items].reverse().find((i) => {
    if (i.hidden || i.locked) return false;
    if (i.kind === 'poly' && inPoly(p, i.pts)) return true;
    const v = i.pts;
    const n = i.kind === 'poly' ? v.length : v.length - 1;
    const tol = (i.kind === 'arrow' ? 26 : 18) * K;
    for (let j = 0; j < n; j++) {
      if (segD(p, v[j], v[(j + 1) % v.length]) < tol) return true;
    }
    return false;
  }) ?? null;
}

type PanelLike = { r?: number[]; fx: number | null; fy: number | null };

export function panelAt(
  p: Point,
  notes: Note[],
  panels: Panels
): PanelLike | null {
  const all: PanelLike[] = [
    ...[...notes].reverse(),
    panels.legend as PanelLike,
    panels.title as PanelLike,
    panels.north as PanelLike,
    panels.scale as PanelLike,
  ].filter(Boolean);
  for (const q of all) {
    const r = q.r;
    if (r && p[0] >= r[0] && p[0] <= r[0] + r[2] && p[1] >= r[1] && p[1] <= r[1] + r[3]) {
      return q;
    }
  }
  return null;
}

export function renderMap(R: RenderCtx) {
  const { ctx, cvW: W, cvH: H } = R;
  const K = W / 1500;
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  ctx.translate(R.pan.x, R.pan.y);
  ctx.scale(R.zoom, R.zoom);

  if (R.base) {
    // On-screen canvas: cached view. Exports (offscreen) draw directly.
    if (R.meta == null && ctx.canvas.isConnected) drawBaseCached(R);
    else ctx.drawImage(baseForSize(R.base, W * (R.pixelRatio || 1) * R.zoom), 0, 0, W, H);
  } else if (R.googleMapActive) {
    ctx.clearRect(0, 0, W, H);
  } else {
    ctx.fillStyle = '#2f4b34';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(255,255,255,.07)';
    ctx.lineWidth = 1;
    for (let x = 0; x < W; x += 50) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
    for (let y = 0; y < H; y += 50) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }

  }

  // committed items
  R.items
    .filter((i) => i.kind === 'poly' && !i.hidden)
    .forEach((i) => drawPoly(R, i.pts, typeById(R.types, i.type).color));
  R.items.filter((i) => i.kind === 'path' && !i.hidden).forEach((i) => drawPath(R, i.pts));
  R.items
    .filter((i) => i.kind === 'arrow' && !i.hidden)
    .forEach((i) =>
      drawEntrance(R, i.pts[0], i.pts[1], i.col || '#ff8a00', i.txt === undefined ? tr('BEJÁRAT') : dt(i.txt), i.fg)
    );

  if (R.opts.oLabels) {
    R.items
      .filter((i) => i.kind === 'poly' && !i.hidden)
      .forEach((i) => {
        const t = typeById(R.types, i.type);
        const c = bbox(i.pts);
        const title = (i.name || '').trim() || dt(t.name);
        const subtitle = ((i.addr || '').trim() || (i.name ? dt(t.name) : '')).slice(0, 48);
        zoneLabel(ctx, c[0], c[1], title, subtitle, t.color, t.lbg, t.fg, K);
      });
  }

  // selection
  if (R.tool === 'sel' && R.selItem && R.items.includes(R.selItem)) {
    const h = rotHandle(R.selItem, K);
    const c = cen(R.selItem.pts);
    ctx.save();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2.5 * K;
    ctx.setLineDash([9 * K, 6 * K]);
    polyPath(ctx, R.selItem.pts, R.selItem.kind === 'poly');
    ctx.stroke();
    ctx.setLineDash([]);
    if (h) {
      ctx.beginPath();
      ctx.moveTo(c[0], c[1]);
      ctx.lineTo(h[0], h[1]);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(h[0], h[1], 14 * K, 0, 7);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.strokeStyle = '#14181f';
      ctx.lineWidth = 3 * K;
      ctx.stroke();
      ctx.fillStyle = '#14181f';
      ctx.font = `700 ${18 * K}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('⟳', h[0], h[1] + 1 * K);
    }
    if (R.selItem.rect) {
      rectHandles(R.selItem).forEach((q) => {
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = '#14181f';
        ctx.lineWidth = 2.5 * K;
        ctx.beginPath();
        ctx.rect(q[0] - 7 * K, q[1] - 7 * K, 14 * K, 14 * K);
        ctx.fill();
        ctx.stroke();
      });
    }
    ctx.restore();
  }

  // in-progress
  const m = R.mouse;
  if ((R.tool === 'poly' || R.tool === 'path') && R.cur.length) {
    const pts = m ? [...R.cur, m] : R.cur;
    if (R.tool === 'poly') drawPoly(R, pts, typeById(R.types, R.sel).color, false, true);
    else drawPath(R, pts, true);
  }
  if ((R.tool === 'free' || R.tool === 'fpath') && R.cur.length > 1) {
    if (R.tool === 'free') drawPoly(R, R.cur, typeById(R.types, R.sel).color, false, true);
    else drawPath(R, R.cur, true);
  }
  if (R.tool === 'rect' && R.drag && m) {
    const a = R.drag;
    const pts: Point[] = [a, [m[0], a[1]], m, [a[0], m[1]]];
    drawPoly(R, pts, typeById(R.types, R.sel).color, true, true);
  }
  if ((R.tool === 'arrow' || R.tool === 'tarrow') && R.drag && m) {
    drawEntrance(
      R,
      R.drag,
      m,
      R.tool === 'arrow' ? '#ff8a00' : R.tCol,
      R.tool === 'arrow' ? tr('BEJÁRAT') : tr('Szöveg')
    );
  }
  if (R.tool === 'scale' && R.cur.length) {
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3 * K;
    ctx.setLineDash([6, 6]);
    polyPath(ctx, m && R.cur.length < 2 ? [R.cur[0], m] : R.cur, false);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  drawOverlays(R);
  ctx.restore();
}

function drawOverlays(R: RenderCtx) {
  const { ctx, cvW: W, cvH: H } = R;
  // North arrow / scale default to dark ink on light sketches, white otherwise.
  const lightBg = isLightBackground(R.base);
  const inkDefault = lightBg ? '#17212f' : '#ffffff';
  const inkShadow = lightBg ? 'rgba(255,255,255,.85)' : undefined;
  const K = W / 1500;
  const m = 28 * K;
  if (R.meta) {
    ctx.save();
    ctx.font = `600 ${15 * K}px ${FONT}`;
    const tw = ctx.measureText(R.meta).width;
    const bw = tw + 28 * K;
    const bh = 30 * K;
    const bx = (W - bw) / 2;
    const by = H - bh - 12 * K;
    ctx.fillStyle = 'rgba(17,27,37,.82)';
    rr(ctx, bx, by, bw, bh, 6 * K);
    ctx.fill();
    ctx.fillStyle = '#f8fafc';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(R.meta, W / 2, by + bh / 2 + 1 * K);
    ctx.restore();
  }
  const { notes, panels } = R;
  const title = dt(R.title);
  const sub = dt(R.sub);
  const aT = R.opts.aT / 100;
  const aL = R.opts.aL / 100;
  const PT = panels.title;
  const PL = panels.legend;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (PT as any).r = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (PL as any).r = null;

  if ((title || sub) && !R.liveMap) {
    ctx.font = `800 ${44 * K}px ${FONT}`;
    const w1 = ctx.measureText(title).width;
    ctx.font = `500 ${25 * K}px ${FONT}`;
    const w2 = ctx.measureText(sub).width;
    const w = Math.max(w1, w2) + 56 * K;
    const h = (sub ? 118 : 84) * K;
    const x = PT.fx == null ? m : PT.fx * W;
    const y = PT.fy == null ? m : PT.fy * H;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (PT as any).r = [x, y, w, h];
    ctx.save();
    if (aT > 0) {
      ctx.shadowColor = `rgba(0,0,0,${0.35 * aT})`;
      ctx.shadowBlur = 18 * K;
      ctx.shadowOffsetY = 4 * K;
      ctx.fillStyle = hexA(PT.bg, aT);
      rr(ctx, x, y, w, h, 10 * K);
      ctx.fill();
      ctx.shadowColor = 'transparent';
    }
    if (aT < 0.5) {
      ctx.shadowColor = 'rgba(0,0,0,.85)';
      ctx.shadowBlur = 7 * K;
    }
    ctx.fillStyle = PT.fg || (aT < 0.4 ? '#fff' : '#14181f');
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = `800 ${44 * K}px ${FONT}`;
    ctx.fillText(title, x + 28 * K, y + (sub ? 54 : 56) * K);
    ctx.fillStyle = PT.fg ? hexA(PT.fg, 0.82) : aT < 0.4 ? '#eee' : '#333';
    ctx.font = `500 ${25 * K}px ${FONT}`;
    ctx.fillText(sub, x + 28 * K, y + 92 * K);
    ctx.restore();
  }

  if (R.opts.oLegend) {
    const used = [...new Set(R.items.filter((i) => i.kind === 'poly' && !i.hidden).map((i) => i.type))]
      .map((id) => typeById(R.types, id))
      .filter(Boolean);
    type RowK = 'box' | 'arr' | 'dash';
    const rows: { sw: string; n: string; d: string; k: RowK }[] = used.map((t) => ({ sw: t.color, n: dt(t.name), d: dt(t.desc), k: 'box' }));
    if (R.items.some((i) => i.kind === 'arrow' && !i.hidden && (i.ent || i.txt === undefined)))
      rows.push({ sw: '#ff8a00', n: tr('BEJÁRAT'), d: tr('Gépjármű bejárat a területre'), k: 'arr' });
    if (R.items.some((i) => i.kind === 'path' && !i.hidden))
      rows.push({ sw: PATH_COLOR, n: tr('ÚTVONAL'), d: tr('Belső közlekedési útvonal'), k: 'dash' });
    if (rows.length) {
      ctx.textBaseline = 'alphabetic';
      let mw = 0;
      rows.forEach((r) => {
        ctx.font = `700 ${19 * K}px ${FONT}`;
        mw = Math.max(mw, ctx.measureText(r.n).width);
        ctx.font = `400 ${15 * K}px ${FONT}`;
        mw = Math.max(mw, ctx.measureText(r.d).width);
      });
      const rh = 62 * K;
      const w = mw + 110 * K;
      const h = 70 * K + rows.length * rh;
      const x = PL.fx == null ? W - m - w : PL.fx * W;
      const y = PL.fy == null ? m : PL.fy * H;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (PL as any).r = [x, y, w, h];
      ctx.save();
      if (aL > 0) {
        ctx.shadowColor = `rgba(0,0,0,${0.35 * aL})`;
        ctx.shadowBlur = 18 * K;
        ctx.shadowOffsetY = 4 * K;
        ctx.fillStyle = hexA(PL.bg, aL);
        rr(ctx, x, y, w, h, 10 * K);
        ctx.fill();
        ctx.shadowColor = 'transparent';
      }
      if (aL < 0.5) {
        ctx.shadowColor = 'rgba(0,0,0,.85)';
        ctx.shadowBlur = 7 * K;
      }
      const tc = PL.fg || (aL < 0.4 ? '#fff' : '#14181f');
      const tc2 = PL.fg ? hexA(PL.fg, 0.7) : aL < 0.4 ? '#eee' : '#666';
      ctx.fillStyle = tc;
      ctx.font = `800 ${22 * K}px ${FONT}`;
      ctx.textAlign = 'left';
      ctx.fillText(tr('JELMAGYARÁZAT'), x + 22 * K, y + 40 * K);
      rows.forEach((r, i) => {
        const ry = y + 62 * K + i * rh;
        const sx = x + 22 * K;
        const sy = ry + 4 * K;
        const z = 38 * K;
        if (r.k === 'box') {
          ctx.fillStyle = '#fff';
          ctx.strokeStyle = r.sw;
          ctx.lineWidth = 6 * K;
          ctx.strokeRect(sx + 3 * K, sy + 3 * K, z - 6 * K, z - 6 * K);
          ctx.fillStyle = r.sw + '40';
          ctx.fillRect(sx + 3 * K, sy + 3 * K, z - 6 * K, z - 6 * K);
        } else if (r.k === 'arr') {
          ctx.strokeStyle = r.sw;
          ctx.lineWidth = 5 * K;
          ctx.beginPath();
          ctx.moveTo(sx + z, sy + z / 2);
          ctx.lineTo(sx + 6 * K, sy + z / 2);
          ctx.stroke();
          arrowHead(ctx, [sx + z, sy + z / 2], [sx, sy + z / 2], r.sw, 18 * K);
        } else {
          ctx.strokeStyle = r.sw;
          ctx.lineWidth = 4 * K;
          ctx.setLineDash([8 * K, 6 * K]);
          ctx.beginPath();
          ctx.moveTo(sx, sy + z / 2);
          ctx.lineTo(sx + z - 8 * K, sy + z / 2);
          ctx.stroke();
          ctx.setLineDash([]);
          arrowHead(ctx, [sx, sy + z / 2], [sx + z, sy + z / 2], r.sw, 14 * K);
        }
        ctx.fillStyle = tc;
        ctx.font = `700 ${19 * K}px ${FONT}`;
        ctx.fillText(r.n, x + 78 * K, ry + 20 * K);
        ctx.fillStyle = tc2;
        ctx.font = `400 ${15 * K}px ${FONT}`;
        ctx.fillText(r.d, x + 78 * K, ry + 42 * K);
      });
      ctx.restore();
    }
  }

  // notes
  let nb = H - m;
  notes.forEach((n) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (n as any).r = null;
    const nt = (n.x || '').trim();
    const nh = (n.t || '').trim();
    const aN = n.a / 100;
    if (n.hidden || !(nt || nh)) return;
    const fs = (21 * K * n.z) / 100;
    const lh = fs * 1.38;
    const pad = 20 * K;
    const hh = fs * 1.15 * 1.6;
    const maxW = Math.max(260 * K, W * 0.26);
    const lines: string[] = [];
    ctx.font = `400 ${fs}px ${FONT}`;
    nt.split('\n').forEach((par) => {
      if (!par.trim()) {
        lines.push('');
        return;
      }
      let ln = '';
      par.split(/\s+/).forEach((wrd) => {
        const t = ln ? ln + ' ' + wrd : wrd;
        if (ctx.measureText(t).width > maxW && ln) {
          lines.push(ln);
          ln = wrd;
        } else ln = t;
      });
      lines.push(ln);
    });
    let w = 0;
    lines.forEach((l) => (w = Math.max(w, ctx.measureText(l).width)));
    ctx.font = `800 ${fs * 1.15}px ${FONT}`;
    if (nh) w = Math.max(w, ctx.measureText(nh).width);
    const bw = w + pad * 2;
    const bh = pad * 2 + (nh ? hh : 0) + lines.length * lh;
    const x = n.fx == null ? W - m - bw : n.fx * W;
    const y = n.fy == null ? nb - bh : n.fy * H;
    if (n.fy == null) nb = y - 14 * K;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (n as any).r = [x, y, bw, bh];
    ctx.save();
    if (aN > 0) {
      ctx.shadowColor = `rgba(0,0,0,${0.35 * aN})`;
      ctx.shadowBlur = 18 * K;
      ctx.shadowOffsetY = 4 * K;
      const bg = n.bg || '#ffffff';
      const rgb = bg.match(/^#?([0-9a-f]{6})$/i);
      ctx.fillStyle = rgb
        ? `rgba(${parseInt(rgb[1].slice(0, 2), 16)},${parseInt(rgb[1].slice(2, 4), 16)},${parseInt(rgb[1].slice(4, 6), 16)},${aN})`
        : `rgba(255,255,255,${aN})`;
      rr(ctx, x, y, bw, bh, 10 * K);
      ctx.fill();
      ctx.shadowColor = 'transparent';
    }
    if (aN < 0.5) {
      ctx.shadowColor = 'rgba(0,0,0,.85)';
      ctx.shadowBlur = 7 * K;
    }
    ctx.fillStyle = n.fg || (aN < 0.4 ? '#fff' : '#14181f');
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    let top = y + pad;
    if (nh) {
      ctx.font = `800 ${fs * 1.15}px ${FONT}`;
      ctx.fillText(nh, x + pad, top + fs * 1.15);
      top += hh;
    }
    ctx.font = `400 ${fs}px ${FONT}`;
    lines.forEach((l, i) => ctx.fillText(l, x + pad, top + fs + i * lh));
    ctx.restore();
  });

  // north arrow
  const PN = panels.north;
  const PS = panels.scale;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (PN) (PN as any).r = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (PS) (PS as any).r = null;
  if (R.opts.oNorth && !R.liveMap) {
    // Box around the "N" + arrow; fx/fy store its top-left corner.
    const bw = 64 * K;
    const bh = 106 * K;
    const bx = PN?.fx == null ? m - 2 * K : PN.fx * W;
    const by = PN?.fy == null ? H - m - 122 * K : PN.fy * H;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (PN) (PN as any).r = [bx, by, bw, bh];
    const cx = bx + bw / 2;
    const cy = by + 62 * K;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.6)';
    ctx.shadowBlur = 6 * K;
    if (inkShadow && !PN?.fg) ctx.shadowColor = inkShadow;
    ctx.fillStyle = PN?.fg || inkDefault;
    ctx.font = `800 ${26 * K}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('N', cx, cy - 34 * K);
    ctx.beginPath();
    ctx.moveTo(cx, cy - 26 * K);
    ctx.lineTo(cx + 26 * K, cy + 40 * K);
    ctx.lineTo(cx, cy + 22 * K);
    ctx.lineTo(cx - 26 * K, cy + 40 * K);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // scale
  if (R.opts.oScale && R.mpp && !R.liveMap) {
    const target = W * 0.14 * R.mpp;
    const nice = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000].reduce(
      (a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a)
    );
    const len = nice / R.mpp;
    // Box around bar + labels; fx/fy store its top-left corner.
    const bw = len + 34 * K;
    const bh = 60 * K;
    const bx = PS?.fx == null ? m + 98 * K : PS.fx * W;
    const by = PS?.fy == null ? H - m - 60 * K : PS.fy * H;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (PS) (PS as any).r = [bx, by, bw, bh];
    const x = bx + 12 * K;
    const y = by + 46 * K;
    const col = PS?.fg || inkDefault;
    ctx.save();
    ctx.shadowColor = inkShadow && !PS?.fg ? inkShadow : 'rgba(0,0,0,.7)';
    ctx.shadowBlur = 5 * K;
    ctx.strokeStyle = col;
    ctx.fillStyle = col;
    ctx.lineWidth = 4 * K;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + len, y);
    for (let i = 0; i <= 4; i++) {
      ctx.moveTo(x + (len * i) / 4, y);
      ctx.lineTo(x + (len * i) / 4, y - (i % 4 ? 10 : 18) * K);
    }
    ctx.stroke();
    ctx.font = `700 ${20 * K}px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('0', x - 4 * K, y - 26 * K);
    ctx.textAlign = 'right';
    ctx.fillText(nice + ' m', x + len + 10 * K, y - 26 * K);
    ctx.restore();
  }
}

export { drawEntrance, drawPoly, drawPath };
