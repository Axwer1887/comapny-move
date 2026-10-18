import { useCallback, useEffect, useRef, useState } from 'react';
import { dt, locale, t as tr, useLang } from '@/lib/i18n';
import type {
  EnhanceOpts,
  MapItem,
  MapState,
  Note,
  Panels,
  Point,
  RangeOpts,
  Tool,
  ZoneType,
} from '@/types';
import { DEFAULT_MAP_VIEW, DEFAULT_SUB, DEFAULT_TITLE, DEFAULT_TYPES, PALETTE, makeEmptyState, emptyPanels, normalizePanels, resetPanelPositions } from '@/lib/defaults';
import type { BgSource, LapData, MapView, PanelPos } from '@/types';
import { buildEnhanced } from '@/lib/enhance';
import { isPdf, openPdf, PDF_MAX_BYTES, renderPdfPage } from '@/lib/pdfImport';
import { renderMap, type RenderCtx, hitTestItem, panelAt } from '@/lib/draw';
import {
  cen,
  rdp,
  rectHandles,
  rotatePts,
  rotHandle,
  RS,
  smooth,
} from '@/lib/geometry';
import {
  canonicalName,
  deleteProject,
  getAuto,
  listProjects,
  saveAuto,
  saveProject,
  storageAvailable,
} from '@/lib/storage';
import { buildPdf } from '@/lib/pdf';

/**
 * A project snapshot arriving from a file or from browser storage is untrusted
 * input: `JSON.parse` succeeding says nothing about the shape, and `restore`
 * dereferences nested fields. Validate before restoring so a corrupt or
 * hand-edited file produces a friendly message instead of a blank editor.
 */
function isValidMapState(st: unknown): st is MapState {
  if (!st || typeof st !== 'object') return false;
  const s = st as Record<string, unknown>;
  if (!Array.isArray(s.types) || !Array.isArray(s.items)) return false;
  if (!s.types.every((t) => t && typeof t === 'object')) return false;
  if (!s.items.every((i) => i && typeof i === 'object' && Array.isArray((i as { pts?: unknown }).pts))) {
    return false;
  }
  if (s.notes != null && !Array.isArray(s.notes)) return false;
  const panels = s.panels as { title?: unknown; legend?: unknown } | undefined;
  if (!panels || typeof panels !== 'object') return false;
  if (!panels.title || typeof panels.title !== 'object') return false;
  if (!panels.legend || typeof panels.legend !== 'object') return false;
  if (s.img != null && typeof s.img !== 'string') return false;
  // Only raster data URLs are ever produced by this app; anything else (remote
  // URLs, javascript:, blob handles from another origin) is rejected.
  if (typeof s.img === 'string' && s.img && !/^data:image\//i.test(s.img)) return false;
  return true;
}

export interface DisplayOptsState {
  oLegend: boolean;
  oNorth: boolean;
  oScale: boolean;
  oLabels: boolean;
  oFill: boolean;
}

interface MoveState {
  t: 'panel' | 'rot' | 'rs' | 'move';
  k?: Note | Panels['title'] | Panels['legend'];
  dx?: number;
  dy?: number;
  c?: Point;
  o?: Point[];
  r0?: number;
  a0?: number;
  i?: number;
  O?: Point;
  eu?: Point;
  ev?: Point;
  w?: number;
  h?: number;
  last?: Point;
}

export interface ProjectMeta {
  name: string;
  t: number;
  count: number;
}

const SNAP_OPTS_KEY = 'terkep:opts';

function loadSnapOpts(): {
  display: DisplayOptsState;
  enhance: EnhanceOpts;
  range: RangeOpts;
  autoSel: boolean;
} {
  try {
    const raw = localStorage.getItem(SNAP_OPTS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return {
    display: { oLegend: true, oNorth: true, oScale: true, oLabels: true, oFill: true },
    enhance: { eSh: 0, eCo: 100, eSa: 100, eBr: 100, eUp: false },
    range: { aT: 100, aL: 100, sm: 14 },
    autoSel: true,
  };
}

function saveSnapOpts(v: unknown) {
  try {
    localStorage.setItem(SNAP_OPTS_KEY, JSON.stringify(v));
  } catch {
    /* ignore */
  }
}

/** Highest canvas zoom (5 = 500 %). */
export const MAX_ZOOM = 5;

export function useMapEditor() {
  // Re-render (and redraw the map's own labels) when the UI language changes.
  const lang = useLang();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [types, setTypes] = useState<ZoneType[]>(() => DEFAULT_TYPES());
  const nextIdRef = useRef(6);
  const [sel, setSel] = useState(1);
  const [items, setItems] = useState<MapItem[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [panels, setPanels] = useState<Panels>(() => emptyPanels());
  const [mpp, setMpp] = useState<number | null>(null);
  const [title, setTitle] = useState(tr('FORGATÁSI HELYSZÍN TÉRKÉP'));
  const [sub, setSub] = useState(tr('Város, utca, helyszín neve, irányítószám'));
  const [projectName, setProjectName] = useState(tr('Új projekt'));

  // Start in selection mode so a live Google map can be panned right away.
  const [tool, setTool] = useState<Tool>('sel');
  const curRef = useRef<Point[]>([]);
  const dragRef = useRef<Point | null>(null);
  const mouseRef = useRef<Point | null>(null);
  const mvRef = useRef<MoveState | null>(null);
  const [selItem, setSelItem] = useState<MapItem | null>(null);
  const focusSelRef = useRef(false);
  const [tCol, setTCol] = useState('#ef1c25');

  const optsRef = useRef(loadSnapOpts());
  const [display, setDisplay] = useState<DisplayOptsState>(optsRef.current.display);
  const [enhance, setEnhance] = useState<EnhanceOpts>(optsRef.current.enhance);
  const [range, setRange] = useState<RangeOpts>(optsRef.current.range);
  const [autoSel, setAutoSel] = useState(optsRef.current.autoSel);
  const [googleMapActive, setGoogleMapActive] = useState(false);
  const [mapView, setMapView] = useState<MapView>({ ...DEFAULT_MAP_VIEW });
  const [mapLocked, setMapLocked] = useState(false);
  const mapLockedRef = useRef(false);
  mapLockedRef.current = mapLocked;

  const origRef = useRef<HTMLImageElement | null>(null);
  const origDataRef = useRef<string | null>(null);
  /** Source of the current background: frozen Google view or own upload. */
  const bgSourceRef = useRef<BgSource>(null);
  const baseRef = useRef<HTMLCanvasElement | null>(null);
  const [cw, setCw] = useState(1500);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const chRef = useRef(1000);
  const panRef = useRef<{ lastX: number; lastY: number } | null>(null);
  const spaceRef = useRef(false);

  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [pMsg, setPMsg] = useState('');
  // Mirrors scaleMetersRef so the metres field re-renders while typing.
  const [scaleMetersUi, setScaleMetersUi] = useState(50);
  /** Keep street names / labels on the frozen Google map (default: clean map). */
  const [captureLabels, setCaptureLabelsState] = useState<boolean>(() => {
    try {
      return localStorage.getItem('forgterkep.captureLabels') === '1';
    } catch {
      return false;
    }
  });
  const setCaptureLabels = useCallback((on: boolean) => {
    setCaptureLabelsState(on);
    try {
      localStorage.setItem('forgterkep.captureLabels', on ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, []);
  /** Cloud save status shown in the project card. */
  const [saveState, setSaveState] = useState<'idle' | 'dirty' | 'saving' | 'saved' | 'error'>('idle');
  const [lastModified, setLastModified] = useState<number | null>(null);
  // Restores fire several state updates (incl. async image builds); ignore
  // those for a moment so loading a project does not look like an edit.
  const quietUntilRef = useRef(0);
  const [storageOk, setStorageOk] = useState(true);
  const readyRef = useRef(false);
  const autoTRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const lapIdRef = useRef<string>('lap-1');
  const [laps, setLaps] = useState<LapData[]>([
    { id: 'lap-1', name: tr('{n}. nap', { n: 1 }), items: [], notes: [], panels: emptyPanels(), title: tr('FORGATÁSI HELYSZÍN TÉRKÉP'), sub: tr('Város, utca, helyszín neve, irányítószám') },
  ]);
  const [activeLapId, setActiveLapId] = useState<string>('lap-1');

  const histRef = useRef<{ past: MapItem[][]; future: MapItem[][] }>({ past: [], future: [] });
  const prevItemsRef = useRef<MapItem[]>([]);
  const skipHistRef = useRef(false);
  const histTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  // keep mutable refs in sync with state for the render/pointer closures
  const stateRef = useRef({
    types,
    items,
    notes,
    panels,
    mpp,
    title,
    sub,
    sel,
    tool,
    selItem,
    tCol,
    display,
    range,
    zoom,
    pan,
    googleMapActive,
  });
  useEffect(() => {
    stateRef.current = {
      types,
      items,
      notes,
      panels,
      mpp,
      title,
      sub,
      sel,
      tool,
      selItem,
      tCol,
      display,
      range,
      zoom,
      pan,
      googleMapActive,
    };
  });

  // persist option preferences
  useEffect(() => {
    saveSnapOpts({ display, enhance, range, autoSel });
  }, [display, enhance, range, autoSel]);

  const K = useCallback(() => cw / 1500, [cw]);

  // Footer line ("project · sheet · date") drawn only on exports.
  const metaInfoRef = useRef({ projectName: '', lapName: '' });
  const exportMeta = () => {
    const { projectName: pn0, lapName: ln0 } = metaInfoRef.current;
    const pn = dt(pn0);
    const lapName = dt(ln0);
    const date = new Date().toLocaleDateString(locale(), { year: 'numeric', month: '2-digit', day: '2-digit' });
    return [pn, lapName, date].filter(Boolean).join('  ·  ');
  };

  /** e.g. "nyari-forgatas-1-nap.png"; falls back to the app name. */
  const exportFileName = (ext: string) => {
    const { projectName: pn, lapName } = metaInfoRef.current;
    const slug = [dt(pn), dt(lapName)]
      .filter(Boolean)
      .join(' ')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return `${slug || 'company-move-terkep'}.${ext}`;
  };

  const exportMetaRef = useRef(exportMeta);
  exportMetaRef.current = exportMeta;

  metaInfoRef.current = {
    projectName: projectName.trim(),
    lapName: laps.find((l) => l.id === activeLapId)?.name || '',
  };


  /**
   * Device pixels per logical canvas unit. The canvas keeps its logical
   * coordinate system (cw × ch — all items, panels and saves use it) but its
   * backing store is sized to the on-screen size × devicePixelRatio, so text,
   * arrows and boards are drawn crisply instead of being upscaled (blurry).
   */
  const prRef = useRef(1);
  const logicalW = () => (canvasRef.current ? canvasRef.current.width / prRef.current : cw);
  const logicalH = () => (canvasRef.current ? canvasRef.current.height / prRef.current : chRef.current);

  /**
   * Draw the map onto any canvas. `pr` = device pixels per logical unit.
   * `exportMode` renders the whole map (no zoom/pan, no editing aids) with
   * the export footer.
   */
  const paint = useCallback((cv: HTMLCanvasElement, pr: number, exportMode = false) => {
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const s = stateRef.current;
    ctx.setTransform(pr, 0, 0, pr, 0, 0);
    ctx.imageSmoothingQuality = 'high';
    const R: RenderCtx = {
      ctx,
      cvW: cv.width / pr,
      cvH: cv.height / pr,
      base: baseRef.current,
      googleMapActive: s.googleMapActive,
      liveMap: Boolean(s.googleMapActive && !baseRef.current && !mapLockedRef.current),
      types: s.types,
      items: s.items,
      title: s.title,
      sub: s.sub,
      notes: s.notes,
      panels: s.panels,
      opts: { ...s.display, aT: s.range.aT, aL: s.range.aL },
      mpp: s.mpp,
      tool: exportMode ? 'sel' : s.tool,
      sel: s.sel,
      cur: exportMode ? [] : curRef.current,
      mouse: exportMode ? null : mouseRef.current,
      drag: exportMode ? null : dragRef.current,
      selItem: exportMode ? null : s.selItem,
      tCol: s.tCol,
      zoom: exportMode ? 1 : s.zoom,
      pan: exportMode ? { x: 0, y: 0 } : s.pan,
      meta: exportMode ? exportMetaRef.current() : null,
      pixelRatio: pr,
    };
    renderMap(R);
  }, []);

  // Many events (pointer moves can arrive several hundred times a second)
  // ask for a redraw; coalesce them into one paint per screen frame.
  const rafRef = useRef(0);
  const render = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      const cv = canvasRef.current;
      if (cv) paint(cv, prRef.current);
    });
  }, [paint]);

  /**
   * Full-resolution offscreen render for PNG / PDF / print: at least the
   * map's own resolution (and at least what is on screen), independent of
   * the current zoom.
   */
  const makeExportCanvas = () => {
    // Logical size from the live canvas: the export callbacks are memoised,
    // so the `cw` captured in this closure may be stale.
    const w = logicalW();
    const h = logicalH();
    const out = document.createElement('canvas');
    let pr = Math.max(1, prRef.current);
    pr = Math.min(pr, Math.sqrt(36e6 / (w * h)));
    out.width = Math.round(w * pr);
    out.height = Math.round(h * pr);
    paint(out, out.width / w, true);
    return out;
  };

  const scheduleAutoSave = useCallback(() => {
    if (!readyRef.current) return;
    if (autoTRef.current) clearTimeout(autoTRef.current);
    autoTRef.current = setTimeout(() => {
      // Read through the ref: this callback is memoised, so calling
      // snapshot() directly would save the state from the first render.
      const snap: MapState & { name: string; auto: boolean } = {
        ...snapshotRef.current(),
        name: '__auto',
        auto: true,
      };
      saveAuto(snap);
    }, 1200);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [render]);

  function currentLapSynced(): LapData[] {
    return laps.map((l) =>
      l.id === activeLapId
        ? { ...l, items, notes, panels, title, sub, img: origDataRef.current, bgSource: bgSourceRef.current, cw, ch: chRef.current, mpp, mapView }
        : l
    );
  }

  const enhanceRef = useRef(enhance);
  enhanceRef.current = enhance;
  const snapshotRef = useRef<() => MapState>(() => snapshot());
  snapshotRef.current = () => snapshot();

  function snapshot(): MapState {
    return {
      v: 1,
      t: Date.now(),
      pn: projectName,
      title,
      sub,
      types,
      nextId: nextIdRef.current,
      sel,
      items,
      panels: normalizePanels(panels),
      notes: notes.map((n) => ({ t: n.t, x: n.x, a: n.a, z: n.z, fx: n.fx, fy: n.fy, bg: n.bg, fg: n.fg, hidden: n.hidden || undefined })),
      mpp,
      cw,
      img: origDataRef.current, bgSource: bgSourceRef.current,
      mapView,
      mapLocked,
      laps: currentLapSynced(),
      activeLapId,
    };
  }

  const restore = useCallback(
    (st: MapState) => {
      quietUntilRef.current = Date.now() + 1500;
      setLastModified(typeof st.t === 'number' ? st.t : null);
      setSaveState('idle');
      setTypes(st.types);
      nextIdRef.current = typeof st.nextId === 'number' ? st.nextId : 6;
      setSel(typeof st.sel === 'number' ? st.sel : 1);
      setItems(st.items);
      setSelItem(null);
      curRef.current = [];
      setMpp(st.mpp);
      setZoom(1);
      setPan({ x: 0, y: 0 });
      setPanels(normalizePanels(st.panels));
      setNotes(
        (st.notes || []).map((n) => ({
          t: n.t || '',
          x: n.x || '',
          a: n.a == null ? 100 : n.a,
          z: n.z == null ? 100 : n.z,
          fx: n.fx == null ? null : n.fx,
          fy: n.fy == null ? null : n.fy,
          bg: n.bg || '#ffffff',
          fg: n.fg || '#14181f',
          hidden: n.hidden || undefined,
        }))
      );
      setTitle(st.title || DEFAULT_TITLE());
      setSub(st.sub || DEFAULT_SUB());
      if (st.pn) setProjectName(canonicalName(st.pn));
      const restoredLaps: LapData[] = st.laps && st.laps.length
        ? st.laps
            .filter((l) => l && typeof l === 'object' && Array.isArray(l.items))
            .map((l, i) => ({
              id: l.id || `lap-${i + 1}`,
              name: l.name || tr('{n}. nap', { n: i + 1 }),
              items: l.items,
              notes: Array.isArray(l.notes) ? l.notes : [],
              panels: normalizePanels(l.panels),
              title: l.title || DEFAULT_TITLE(),
              sub: l.sub || DEFAULT_SUB(),
              img: l.img || (i === 0 ? st.img || null : null),
              bgSource: l.bgSource ?? (i === 0 ? st.bgSource : undefined),
              cw: l.cw || (i === 0 ? st.cw : undefined),
              ch: l.ch,
              mpp: l.mpp == null ? (i === 0 ? st.mpp : null) : l.mpp,
              mapView: l.mapView || (i === 0 ? st.mapView : undefined),
            }))
        : [];
      if (!restoredLaps.length) {
        restoredLaps.push({
          id: 'lap-1',
          name: tr('{n}. nap', { n: 1 }),
          items: st.items,
          notes: Array.isArray(st.notes) ? st.notes : [],
          panels: normalizePanels(st.panels),
          title: st.title || DEFAULT_TITLE(),
          sub: st.sub || DEFAULT_SUB(),
          img: st.img || null,
          bgSource: st.bgSource,
          cw: st.cw,
          ch: Math.round((st.cw || 1500) * (2 / 3)),
          mpp: st.mpp,
          mapView: st.mapView,
        });
      }
      setLaps(restoredLaps);
      const restoredActiveId = st.activeLapId && restoredLaps.some((l) => l.id === st.activeLapId) ? st.activeLapId : restoredLaps[0].id;
      const activeLap = restoredLaps.find((l) => l.id === restoredActiveId) || restoredLaps[0];
      lapIdRef.current = restoredActiveId;
      setActiveLapId(restoredActiveId);
      setMpp(activeLap.mpp ?? null);
      origDataRef.current = activeLap.img || null;
      bgSourceRef.current = activeLap.bgSource ?? (activeLap.img ? 'upload' : null);
      setMapView(activeLap.mapView || st.mapView || { ...DEFAULT_MAP_VIEW });
      setMapLocked(Boolean(activeLap.img || st.img));
      if (activeLap.img) {
        const im = new Image();
        im.onload = () => {
          origRef.current = im;
          // Build directly at the saved width. doBuild() would compare against
          // the pre-restore canvas width and wrongly rescale the restored items,
          // which are already stored in the saved width's coordinates.
          const en = enhanceRef.current;
          const targetW = activeLap.cw || st.cw || Math.round(Math.min(im.naturalWidth * (en.eUp ? 2 : 1), 3600));
          const built = buildEnhanced(im, en, targetW);
          baseRef.current = built.canvas;
          setCw(built.newW);
          chRef.current = built.canvas.height;
          setTimeout(render, 0);
        };
        im.src = activeLap.img;
      } else {
        origRef.current = null;
        baseRef.current = null;
        setCw(activeLap.cw || st.cw || 1500);
        chRef.current = activeLap.ch || Math.round((activeLap.cw || st.cw || 1500) * (2 / 3));
        setTimeout(render, 0);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [render]
  );

  // ---- lap (munkalap) management ----
  const switchLap = useCallback(
    (id: string) => {
      if (id === activeLapId) return;
      const synced = laps.map((l) =>
        l.id === activeLapId ? { ...l, items, notes, panels, title, sub, img: origDataRef.current, bgSource: bgSourceRef.current, cw, ch: chRef.current, mpp, mapView } : l
      );
      const target = synced.find((l) => l.id === id);
      if (!target) return;
      setLaps(synced);
      lapIdRef.current = id;
      setActiveLapId(id);
      setItems(target.items);
      setNotes(target.notes);
      setPanels(normalizePanels(target.panels));
      setTitle(target.title);
      setSub(target.sub);
      setMpp(target.mpp ?? null);
      setMapView(target.mapView || { ...DEFAULT_MAP_VIEW });
      setMapLocked(Boolean(target.img));
      origDataRef.current = target.img || null;
      bgSourceRef.current = target.bgSource ?? (target.img ? 'upload' : null);
      if (target.img) {
        const im = new Image();
        im.onload = () => {
          origRef.current = im;
          const targetW = target.cw || Math.round(Math.min(im.naturalWidth * (enhance.eUp ? 2 : 1), 3600));
          const built = buildEnhanced(im, enhance, targetW);
          baseRef.current = built.canvas;
          setCw(built.newW);
          chRef.current = built.canvas.height;
          setTimeout(render, 0);
        };
        im.src = target.img;
      } else {
        origRef.current = null;
        baseRef.current = null;
        setCw(target.cw || 1500);
        chRef.current = target.ch || Math.round((target.cw || 1500) * (2 / 3));
      }
      setSelItem(null);
      curRef.current = [];
      setZoom(1);
      setPan({ x: 0, y: 0 });
    },
    [activeLapId, laps, items, notes, panels, title, sub, enhance, render, mapView]
  );

  const addLap = useCallback(() => {
    const n = laps.length + 1;
    const id = 'lap-' + Date.now();
    const newLap: LapData = {
      id,
      name: tr('{n}. nap', { n }),
      items: [],
      notes: [],
      panels: emptyPanels(),
      title: tr('FORGATÁSI HELYSZÍN TÉRKÉP'),
      sub: tr('Város, utca, helyszín neve, irányítószám'),
      img: null,
      cw: 1500,
      ch: 1000,
      mpp: null,
      mapView: { ...mapView },
    };
    const synced = laps.map((l) =>
      l.id === activeLapId ? { ...l, items, notes, panels, title, sub, img: origDataRef.current, bgSource: bgSourceRef.current, cw, ch: chRef.current, mpp, mapView } : l
    );
    setLaps([...synced, newLap]);
    lapIdRef.current = id;
    setActiveLapId(id);
    setItems([]);
    setNotes([]);
    setMpp(null);
    origRef.current = null;
    origDataRef.current = null;
    bgSourceRef.current = null;
    baseRef.current = null;
    setCw(newLap.cw || 1500);
    chRef.current = newLap.ch || 1000;
    setPanels(emptyPanels());
    setTitle(newLap.title);
    setSub(newLap.sub);
    setSelItem(null);
    curRef.current = [];
    setMapLocked(false);
  }, [activeLapId, laps, items, notes, panels, title, sub, mapView]);

  const duplicateLap = useCallback((sourceId?: string) => {
    const synced = laps.map((l) =>
      l.id === activeLapId ? { ...l, items, notes, panels, title, sub, img: origDataRef.current, bgSource: bgSourceRef.current, cw, ch: chRef.current, mpp, mapView } : l
    );
    const cur = synced.find((l) => l.id === (sourceId || activeLapId));
    if (!cur) return;
    const n = laps.length + 1;
    const id = 'lap-' + Date.now();
    const copy: LapData = {
      id,
      name: tr('{v0}. nap (másolat)', { v0: n }),
      items: JSON.parse(JSON.stringify(cur.items)),
      notes: JSON.parse(JSON.stringify(cur.notes)),
      panels: JSON.parse(JSON.stringify(cur.panels)),
      title: cur.title,
      sub: cur.sub,
      img: cur.img || null,
      cw: cur.cw,
      ch: cur.ch,
      mpp: cur.mpp ?? null,
      mapView: cur.mapView ? { ...cur.mapView } : { ...mapView },
    };
    setLaps([...synced, copy]);
    lapIdRef.current = id;
    setActiveLapId(id);
    setItems(copy.items);
    setNotes(copy.notes);
    setPanels(normalizePanels(copy.panels));
    setTitle(copy.title);
    setSub(copy.sub);
    setMpp(copy.mpp ?? null);
    setMapView(copy.mapView || { ...DEFAULT_MAP_VIEW });
    setSelItem(null);
    origDataRef.current = copy.img || null;
    bgSourceRef.current = copy.bgSource ?? (copy.img ? 'upload' : null);
    if (copy.img) {
      const im = new Image();
      im.onload = () => {
        origRef.current = im;
        const built = buildEnhanced(im, enhance, copy.cw || Math.round(Math.min(im.naturalWidth * (enhance.eUp ? 2 : 1), 3600)));
        baseRef.current = built.canvas;
        setCw(built.newW);
        chRef.current = built.canvas.height;
        setMapLocked(true);
        setTimeout(render, 0);
      };
      im.src = copy.img;
    } else {
      origRef.current = null;
      baseRef.current = null;
      setCw(copy.cw || 1500);
      chRef.current = copy.ch || 1000;
      setMapLocked(false);
    }
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [activeLapId, laps, items, notes, panels, title, sub, mapView, enhance, render]);

  const deleteLap = useCallback(
    (id: string) => {
      if (laps.length <= 1) return;
      const synced = laps.map((l) =>
        l.id === activeLapId ? { ...l, items, notes, panels, title, sub, img: origDataRef.current, bgSource: bgSourceRef.current, cw, ch: chRef.current, mpp, mapView } : l
      );
      const remaining = synced.filter((l) => l.id !== id);
      setLaps(remaining);
      if (id === activeLapId) {
        const next = remaining[0];
        lapIdRef.current = next.id;
        setActiveLapId(next.id);
        setItems(next.items);
        setNotes(next.notes);
        setPanels(normalizePanels(next.panels));
        setTitle(next.title);
        setSub(next.sub);
        setMpp(next.mpp ?? null);
        setMapView(next.mapView || { ...DEFAULT_MAP_VIEW });
        setMapLocked(Boolean(next.img));
        origDataRef.current = next.img || null;
        bgSourceRef.current = next.bgSource ?? (next.img ? 'upload' : null);
        if (next.img) {
          const im = new Image();
          im.onload = () => {
            origRef.current = im;
            const built = buildEnhanced(im, enhance, next.cw || Math.round(Math.min(im.naturalWidth * (enhance.eUp ? 2 : 1), 3600)));
            baseRef.current = built.canvas;
            setCw(built.newW);
            chRef.current = built.canvas.height;
            setTimeout(render, 0);
          };
          im.src = next.img;
        } else {
          origRef.current = null;
          baseRef.current = null;
        }
        setCw(next.cw || 1500);
        chRef.current = next.ch || Math.round((next.cw || 1500) * (2 / 3));
        setSelItem(null);
        curRef.current = [];
      }
    },
    [activeLapId, laps, items, notes, panels, title, sub, mapView]
  );

  const renameLap = useCallback((id: string, name: string) => {
    setLaps((prev) => prev.map((l) => (l.id === id ? { ...l, name } : l)));
  }, []);

  const doBuild = useCallback(
    (targetW?: number) => {
      const orig = origRef.current;
      if (!orig) return;
      const w = Math.round(
        Math.min(orig.naturalWidth * (enhance.eUp ? 2 : 1), 3600)
      );
      const { canvas, newW } = buildEnhanced(orig, enhance, targetW || w);
      const oldW = cw;
      const oldH = chRef.current;
      const rx = newW / oldW;
      const ry = canvas.height / oldH;
      if (Math.abs(rx - 1) > 1e-6 || Math.abs(ry - 1) > 1e-6) {
        setItems((prev) =>
          prev.map((i) => ({
            ...i,
            pts: i.pts.map((p): Point => [p[0] * rx, p[1] * ry]),
          }))
        );
        curRef.current = [];
        if (mpp) setMpp((m) => (m ? m / rx : m));
      }
      baseRef.current = canvas;
      setCw(newW);
      chRef.current = canvas.height;
      setTimeout(render, 0);
    },
    [enhance, cw, mpp, render]
  );

  // rebuild when enhance opts change
  useEffect(() => {
    if (!origRef.current) return undefined;
    const t = setTimeout(() => doBuild(), 140);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enhance]);

  // render on any state change
  useEffect(() => {
    render();
  }, [
    render,
    items,
    notes,
    panels,
    types,
    title,
    sub,
    display,
    range,
    zoom,
    pan,
    tool,
    sel,
    selItem,
    tCol,
    mpp,
    cw,
    googleMapActive,
    mapLocked,
    lang,
  ]);

  // autosave on changes
  useEffect(() => {
    if (readyRef.current && Date.now() > quietUntilRef.current) {
      setLastModified(Date.now());
      setSaveState((st) => (st === 'saving' ? st : 'dirty'));
    }
    scheduleAutoSave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, notes, panels, types, title, sub, mpp, cw, laps, activeLapId, mapView, mapLocked, display, range]);

  // load projects list
  const refreshProjects = useCallback(async () => {
    const ok = await storageAvailable();
    setStorageOk(ok);
    if (!ok) return;
    const list = await listProjects();
    setProjects(list.map((p) => ({ name: p.name, t: p.t, count: p.items?.length || 0 })));
  }, []);

  // initial load: autosave (local to this browser, so it does not depend on the cloud)
  useEffect(() => {
    (async () => {
      const a = await getAuto();
      if (isValidMapState(a) && (a.items.length || a.img || (a.notes && a.notes.length))) {
        restore(a);
        setPMsg(tr('Legutóbbi munka visszatöltve.'));
      }
      readyRef.current = true;
      refreshProjects();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // pointer helpers
  const screenPos = useCallback((e: React.PointerEvent): Point => {
    const cv = canvasRef.current!;
    const r = cv.getBoundingClientRect();
    return [
      ((e.clientX - r.left) * (cv.width / prRef.current)) / r.width,
      ((e.clientY - r.top) * (cv.height / prRef.current)) / r.height,
    ];
  }, []);

  const pos = useCallback((e: React.PointerEvent): Point => {
    const screen = screenPos(e);
    return [(screen[0] - pan.x) / zoom, (screen[1] - pan.y) / zoom];
  }, [pan.x, pan.y, screenPos, zoom]);

  const finish = useCallback(() => {
    const s = stateRef.current;
    if (s.tool === 'poly' && curRef.current.length >= 3) {
      const newItems = [...s.items, { kind: 'poly' as const, type: s.sel, pts: curRef.current }];
      setItems(newItems);
      if (autoSel) setSelItem(newItems[newItems.length - 1]);
    } else if (s.tool === 'path' && curRef.current.length >= 2) {
      const newItems = [...s.items, { kind: 'path' as const, pts: curRef.current }];
      setItems(newItems);
      if (autoSel) setSelItem(newItems[newItems.length - 1]);
    }
    curRef.current = [];
    if (autoSel) setTool('sel');
  }, [autoSel]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const cv = canvasRef.current;
      if (!cv) return;
      const screen = screenPos(e);
      const p: Point = [(screen[0] - pan.x) / zoom, (screen[1] - pan.y) / zoom];
      const s = stateRef.current;
      const k = K() / zoom;

      if (e.button === 1 || e.button === 2 || spaceRef.current) {
        panRef.current = { lastX: screen[0], lastY: screen[1] };
        cv.setPointerCapture(e.pointerId);
        return;
      }

      // panel hit (non-sel, non-scale, empty cur)
      const pa =
        s.tool !== 'sel' && s.tool !== 'scale' && !curRef.current.length ? panelAt(p, s.notes, s.panels) : null;
      if (pa) {
        setSelItem(null);
        const r = pa.r!;
        mvRef.current = { t: 'panel', k: pa, dx: p[0] - r[0], dy: p[1] - r[1] };
        cv.setPointerCapture(e.pointerId);
        mouseRef.current = p;
        render();
        return;
      }

      if (s.tool === 'sel') {
        const hr = s.selItem?.locked ? null : rotHandle(s.selItem, k);
        let rh = -1;
        if (s.selItem && s.selItem.rect && !s.selItem.locked && s.items.includes(s.selItem)) {
          rectHandles(s.selItem).forEach((q, i) => {
            if (rh < 0 && Math.hypot(p[0] - q[0], p[1] - q[1]) < 18 * k) rh = i;
          });
        }
        if (rh >= 0 && s.selItem) {
          const P = s.selItem.pts;
          const u: Point = [P[1][0] - P[0][0], P[1][1] - P[0][1]];
          const v: Point = [P[3][0] - P[0][0], P[3][1] - P[0][1]];
          const w = Math.hypot(u[0], u[1]) || 1;
          const h = Math.hypot(v[0], v[1]) || 1;
          mvRef.current = {
            t: 'rs',
            i: rh,
            O: P[0].slice() as Point,
            eu: [u[0] / w, u[1] / w],
            ev: [v[0] / h, v[1] / h],
            w,
            h,
          };
        } else if (hr && s.selItem && Math.hypot(p[0] - hr[0], p[1] - hr[1]) < 24 * k) {
          const c = cen(s.selItem.pts);
          mvRef.current = {
            t: 'rot',
            c,
            o: s.selItem.pts.map((q) => q.slice() as Point),
            r0: s.selItem.rot || 0,
            a0: Math.atan2(p[1] - c[1], p[0] - c[0]),
          };
        } else {
          const hit = panelAt(p, s.notes, s.panels);
          if (hit) {
            const r = hit.r!;
            setSelItem(null);
            mvRef.current = { t: 'panel', k: hit, dx: p[0] - r[0], dy: p[1] - r[1] };
          } else {
            const it = hitTestItem(s.items, p, k);
            setSelItem(it);
            if (it) mvRef.current = { t: 'move', last: p };
            // Empty spot: drag to move around the (zoomed) map.
            else {
              panRef.current = { lastX: screen[0], lastY: screen[1] };
              cv.style.cursor = 'grabbing';
            }
          }
        }
        if (mvRef.current || panRef.current) cv.setPointerCapture(e.pointerId);
        mouseRef.current = p;
        render();
        return;
      }

      if (s.tool === 'poly' || s.tool === 'path') {
        curRef.current = [...curRef.current, p];
      } else if (s.tool === 'free' || s.tool === 'fpath') {
        curRef.current = [p];
        dragRef.current = p;
        cv.setPointerCapture(e.pointerId);
      } else if (s.tool === 'rect' || s.tool === 'arrow' || s.tool === 'tarrow') {
        // Arrows also work with two clicks: a pending start point from the
        // first click is kept, and this click/drag sets the tip.
        const pendingArrow = arrowPendingRef.current && dragRef.current && s.tool !== 'rect';
        if (!pendingArrow) dragRef.current = p;
        arrowPendingRef.current = false;
        cv.setPointerCapture(e.pointerId);
      } else if (s.tool === 'scale') {
        curRef.current = [...curRef.current, p];
        if (curRef.current.length === 2) {
          const d = Math.hypot(
            curRef.current[0][0] - curRef.current[1][0],
            curRef.current[0][1] - curRef.current[1][1]
          );
          const m = scaleMetersRef.current || 50;
          if (d > 5) setMpp(m / d);
          curRef.current = [];
          setTool('free');
        }
      }
      mouseRef.current = p;
      render();
    },
    [screenPos, pan.x, pan.y, zoom, render, K]
  );

  const scaleMetersRef = useRef(50);
  const arrowPendingRef = useRef(false);

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const cv = canvasRef.current;
      if (!cv) return;
      const screen = screenPos(e);
      if (panRef.current) {
        const dx = screen[0] - panRef.current.lastX;
        const dy = screen[1] - panRef.current.lastY;
        setPan((current) => ({ x: current.x + dx, y: current.y + dy }));
        panRef.current = { lastX: screen[0], lastY: screen[1] };
        render();
        return;
      }
      const p: Point = [(screen[0] - pan.x) / zoom, (screen[1] - pan.y) / zoom];
      mouseRef.current = p;
      const s = stateRef.current;
      const mv = mvRef.current;
      const k = K() / zoom;

      if (!mv) {
        const hit = panelAt(p, s.notes, s.panels) || (s.tool === 'sel' ? hitTestItem(s.items, p, k) : null);
        cv.style.cursor = hit ? 'move' : s.tool === 'sel' ? 'grab' : 'crosshair';
      }

      if (mv) {
        if (mv.t === 'rot' && s.selItem) {
          let d = Math.atan2(p[1] - mv.c![1], p[0] - mv.c![0]) - mv.a0!;
          if (e.shiftKey) {
            const u = Math.PI / 12;
            d = Math.round((mv.r0! + d) / u) * u - mv.r0!;
          }
          const newPts = rotatePts(mv.o!, mv.c!, d);
          const updated = { ...s.selItem, pts: newPts, rot: mv.r0! + d };
          setSelItem(updated);
          setItems((prev) => prev.map((i) => (i === s.selItem ? updated : i)));
        } else if (mv.t === 'rs' && s.selItem) {
          const d: Point = [p[0] - mv.O![0], p[1] - mv.O![1]];
          const mx = d[0] * mv.eu![0] + d[1] * mv.eu![1];
          const my = d[0] * mv.ev![0] + d[1] * mv.ev![1];
          const xs = [0, mv.w!];
          const ys = [0, mv.h!];
          const H = RS[mv.i!];
          if (H.x != null) xs[H.x] = mx;
          if (H.y != null) ys[H.y] = my;
          const x0 = Math.min(...xs);
          let x1 = Math.max(...xs);
          const y0 = Math.min(...ys);
          let y1 = Math.max(...ys);
          const mn = 12 * k;
          if (x1 - x0 < mn) x1 = x0 + mn;
          if (y1 - y0 < mn) y1 = y0 + mn;
          const newPts: Point[] = (
            [
              [x0, y0],
              [x1, y0],
              [x1, y1],
              [x0, y1],
            ] as Point[]
          ).map(
            (q): Point => [
              mv.O![0] + q[0] * mv.eu![0] + q[1] * mv.ev![0],
              mv.O![1] + q[0] * mv.eu![1] + q[1] * mv.ev![1],
            ]
          );
          const updated = { ...s.selItem, pts: newPts };
          setSelItem(updated);
          setItems((prev) => prev.map((i) => (i === s.selItem ? updated : i)));
        } else if (mv.t === 'move' && s.selItem) {
          const dx = p[0] - mv.last![0];
          const dy = p[1] - mv.last![1];
          const newPts = s.selItem.pts.map((q): Point => [q[0] + dx, q[1] + dy]);
          const updated = { ...s.selItem, pts: newPts };
          setSelItem(updated);
          setItems((prev) => prev.map((i) => (i === s.selItem ? updated : i)));
          mv.last = p;
        } else if (mv.t === 'panel' && mv.k) {
          const pn = mv.k as { fx: number | null; fy: number | null };
          pn.fx = (p[0] - mv.dx!) / logicalW();
          pn.fy = (p[1] - mv.dy!) / logicalH();
          // force re-render via state update
          if ('t' in pn) {
            setNotes((prev) => [...prev]);
          } else {
            setPanels((prev) => ({ ...prev }));
          }
        }
        render();
        return;
      }

      if (dragRef.current && (s.tool === 'free' || s.tool === 'fpath')) {
        curRef.current = [...curRef.current, p];
      }
      if (curRef.current.length || dragRef.current) render();
    },
    [screenPos, pan.x, pan.y, zoom, render, K]
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const cv = canvasRef.current;
      if (!cv) return;
      panRef.current = null;
      const mv = mvRef.current;
      if (mv) {
        mvRef.current = null;
        render();
        return;
      }
      const s = stateRef.current;
      if (!dragRef.current) return;
      const p = pos(e);
      const k = K() / zoom;

      if (s.tool === 'free' || s.tool === 'fpath') {
        const pts = curRef.current;
        const e2 = (range.sm * k);
        curRef.current = [];
        dragRef.current = null;
        if (pts.length > 4) {
          if (s.tool === 'free') {
            let f = 0;
            let md = 0;
            pts.forEach((q, i) => {
              const d = Math.hypot(q[0] - pts[0][0], q[1] - pts[0][1]);
              if (d > md) {
                md = d;
                f = i;
              }
            });
            const z = rdp(pts.slice(0, f + 1), e2)
              .slice(0, -1)
              .concat(rdp(pts.slice(f), e2));
            if (z.length >= 3) {
              const newItem: MapItem = { kind: 'poly', type: s.sel, pts: z };
              const ni = [...s.items, newItem];
              setItems(ni);
              if (autoSel) {
                setSelItem(newItem);
                setTool('sel');
              }
            }
          } else {
            const newItem: MapItem = { kind: 'path', pts: smooth(rdp(pts, e2 * 0.5)) };
            const ni = [...s.items, newItem];
            setItems(ni);
            if (autoSel) {
              setSelItem(newItem);
              setTool('sel');
            }
          }
        }
        render();
        return;
      }

      const dragged = Math.hypot(p[0] - dragRef.current[0], p[1] - dragRef.current[1]) > 8;
      if (!dragged && (s.tool === 'arrow' || s.tool === 'tarrow')) {
        // A plain click: remember it as the start and wait for the tip click.
        arrowPendingRef.current = true;
        mouseRef.current = p;
        render();
        return;
      }
      if (dragged) {
        if (s.tool === 'rect') {
          const newItem: MapItem = {
            kind: 'poly',
            type: s.sel,
            rot: 0,
            rect: true,
            pts: [dragRef.current, [p[0], dragRef.current[1]], p, [dragRef.current[0], p[1]]],
          };
          const ni = [...s.items, newItem];
          setItems(ni);
          setSelItem(newItem);
          setTool('sel');
        } else if (s.tool === 'tarrow') {
          const newItem: MapItem = {
            kind: 'arrow',
            txt: tr('Szöveg'),
            col: s.tCol,
            pts: [dragRef.current, p],
          };
          const ni = [...s.items, newItem];
          setItems(ni);
          if (autoSel) {
            setSelItem(newItem);
            setTool('sel');
            focusSelRef.current = true;
          }
        } else if (s.tool === 'arrow') {
          const newItem: MapItem = {
            kind: 'arrow',
            ent: true,
            txt: tr('BEJÁRAT'),
            col: '#ff8a00',
            pts: [dragRef.current, p],
          };
          const ni = [...s.items, newItem];
          setItems(ni);
          if (autoSel) {
            setSelItem(newItem);
            setTool('sel');
          }
        }
      }
      dragRef.current = null;
      render();
    },
    [pos, render, K, zoom, range.sm, autoSel]
  );

  const onDblClick = useCallback(() => {
    const s = stateRef.current;
    if (s.tool === 'poly' || s.tool === 'path') {
      curRef.current = curRef.current.slice(0, -1);
      finish();
    }
  }, [finish]);

  const changeZoom = useCallback((delta: number, focal?: { x: number; y: number }) => {
    // Without a pointer position (toolbar buttons, menu) zoom around the
    // centre of the canvas instead of its top-left corner.
    const cv = canvasRef.current;
    const f = focal || (cv ? { x: cv.width / prRef.current / 2, y: cv.height / prRef.current / 2 } : undefined);
    setZoom((value) => {
      const newZoom = Math.min(MAX_ZOOM, Math.max(0.2, Number((value + delta).toFixed(3))));
      if (newZoom === value) return value;
      if (f) {
        const ratio = newZoom / value;
        setPan((p) => ({
          x: f.x - (f.x - p.x) * ratio,
          y: f.y - (f.y - p.y) * ratio,
        }));
      }
      return newZoom;
    });
  }, []);

  // Keep the map inside the view: when zoomed in, its edges may not move past
  // the frame's edges; when zoomed out, it stays within the frame.
  useEffect(() => {
    const W = logicalW();
    const H = logicalH();
    const clamp = (v: number, size: number) => {
      const lo = Math.min(0, size - size * zoom);
      const hi = Math.max(0, size - size * zoom);
      return Math.min(hi, Math.max(lo, v));
    };
    const nx = clamp(pan.x, W);
    const ny = clamp(pan.y, H);
    if (Math.abs(nx - pan.x) > 0.5 || Math.abs(ny - pan.y) > 0.5) setPan({ x: nx, y: ny });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pan.x, pan.y, zoom, cw]);

  /** Mouse wheel / pinch: zoom around the pointer. */
  const wheelZoom = useCallback((deltaY: number, clientX: number, clientY: number) => {
    const cv = canvasRef.current;
    if (!cv) return;
    const r = cv.getBoundingClientRect();
    const fx = ((clientX - r.left) * (cv.width / prRef.current)) / r.width;
    const fy = ((clientY - r.top) * (cv.height / prRef.current)) / r.height;
    setZoom((value) => {
      const z = Math.min(MAX_ZOOM, Math.max(0.2, Number((value * Math.exp(-deltaY * 0.0015)).toFixed(3))));
      if (z === value) return value;
      const ratio = z / value;
      setPan((pp) => ({ x: fx - (fx - pp.x) * ratio, y: fy - (fy - pp.y) * ratio }));
      return z;
    });
  }, []);

  /** Jump to an exact zoom level (e.g. 1.5 = 150%), centred on the canvas. */
  const zoomTo = useCallback((target: number) => {
    const z = Math.min(MAX_ZOOM, Math.max(0.2, Number(target.toFixed(3))));
    const cv = canvasRef.current;
    setZoom((value) => {
      if (cv && value !== z) {
        const fx = cv.width / prRef.current / 2;
        const fy = cv.height / prRef.current / 2;
        const ratio = z / value;
        setPan((p) => ({ x: fx - (fx - p.x) * ratio, y: fy - (fy - p.y) * ratio }));
      }
      return z;
    });
  }, []);

  const fitView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  // ---- actions ----
  const setToolAction = useCallback(
    (t: Tool) => {
      curRef.current = [];
      dragRef.current = null;
      setTool(t);
    },
    []
  );

  const addType = useCallback(() => {
    const c = PALETTE[types.length % PALETTE.length];
    const id = nextIdRef.current;
    setTypes((prev) => [...prev, { id, name: tr('ÚJ ZÓNA'), desc: tr('Leírás'), color: c }]);
    setSel(id);
    nextIdRef.current = id + 1;
  }, [types.length]);

  const removeType = useCallback(
    (t: ZoneType) => {
      setTypes((prev) => {
        if (prev.length < 2) return prev;
        return prev.filter((x) => x !== t);
      });
      setItems((prev) => prev.filter((i) => i.type !== t.id));
      if (sel === t.id) setSel(types[0].id);
    },
    [sel, types]
  );

  const updateType = useCallback(
    (id: number, patch: Partial<ZoneType>) => {
      setTypes((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
    },
    []
  );

  const undo = useCallback(() => {
    if (curRef.current.length) {
      curRef.current = curRef.current.slice(0, -1);
      render();
      return;
    }
    const h = histRef.current;
    if (h.past.length === 0) return;
    h.future.push(items);
    const prev = h.past.pop()!;
    skipHistRef.current = true;
    prevItemsRef.current = prev;
    setItems(prev);
    setSelItem(null);
    setCanUndo(h.past.length > 0);
    setCanRedo(h.future.length > 0);
  }, [items, render]);

  const redo = useCallback(() => {
    const h = histRef.current;
    if (h.future.length === 0) return;
    h.past.push(items);
    const next = h.future.pop()!;
    skipHistRef.current = true;
    prevItemsRef.current = next;
    setItems(next);
    setSelItem(null);
    setCanUndo(h.past.length > 0);
    setCanRedo(h.future.length > 0);
  }, [items]);

  const clearAll = useCallback(() => {
    setItems([]);
    curRef.current = [];
    setSelItem(null);
    render();
  }, [render]);

  const removeItem = useCallback((idx: number) => {
    setItems((prev) => prev.filter((_, i) => i !== idx));
    setSelItem(null);
  }, []);

  /** Show / hide a whole layer: a zone category, all routes, arrows or notes. */
  const setLayerHidden = useCallback((layer: number | 'path' | 'arrow' | 'notes', hidden: boolean) => {
    if (layer === 'notes') {
      setNotes((prev) => prev.map((n) => ({ ...n, hidden: hidden || undefined })));
      return;
    }
    const match = (it: MapItem) =>
      layer === 'path' ? it.kind === 'path' : layer === 'arrow' ? it.kind === 'arrow' : it.kind === 'poly' && it.type === layer;
    setItems((prev) => prev.map((it) => (match(it) ? { ...it, hidden: hidden || undefined } : it)));
    setSelItem((cur) => (cur && match(cur) && hidden ? null : cur));
  }, []);

  /** Copy the selected element slightly offset and select the copy. */
  const duplicateItem = useCallback(() => {
    if (!selItem) return;
    const d = 24 * (cw / 1500);
    const copy: MapItem = {
      ...selItem,
      locked: undefined,
      name: selItem.name ? selItem.name + tr(' (másolat)') : undefined,
      pts: selItem.pts.map((q): Point => [q[0] + d, q[1] + d]),
    };
    setItems((prev) => [...prev, copy]);
    setSelItem(copy);
  }, [selItem, cw]);

  const toggleItemHidden = useCallback((idx: number) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, hidden: !it.hidden } : it)));
  }, []);

  const selectItem = useCallback((idx: number) => {
    setSelItem(items[idx] ?? null);
    setTool('sel');
  }, [items]);

  const updateSelItem = useCallback((patch: Partial<MapItem>) => {
    if (!selItem) return;
    const updated = { ...selItem, ...patch };
    setSelItem(updated);
    setItems((prev) => prev.map((i) => (i === selItem ? updated : i)));
  }, [selItem]);

  const moveItem = useCallback((idx: number, dir: -1 | 1) => {
    setItems((prev) => {
      const j = idx + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      const [it] = next.splice(idx, 1);
      next.splice(j, 0, it);
      return next;
    });
  }, []);

  const rotateSel90 = useCallback(() => {
    if (!selItem) return;
    const c = cen(selItem.pts);
    const newPts = selItem.pts.map(
      (q): Point => [c[0] - (q[1] - c[1]), c[1] + (q[0] - c[0])]
    );
    const updated = { ...selItem, pts: newPts, rot: (selItem.rot || 0) + Math.PI / 2 };
    setSelItem(updated);
    setItems((prev) => prev.map((i) => (i === selItem ? updated : i)));
  }, [selItem]);

  const resetPanels = useCallback(() => {
    setPanels((prev) => resetPanelPositions(prev));
    setNotes((prev) => prev.map((n) => ({ ...n, fx: null, fy: null })));
  }, []);

  const updatePanelStyle = useCallback((key: keyof Panels, patch: Partial<Pick<PanelPos, 'bg' | 'fg'>>) => {
    setPanels((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  }, []);

  const addNote = useCallback(() => {
    setNotes((prev) => [...prev, { t: '', x: '', a: 100, z: 100, fx: null, fy: null, bg: '#ffffff', fg: '#14181f' }]);
  }, []);

  const updateNote = useCallback((idx: number, patch: Partial<Note>) => {
    setNotes((prev) => prev.map((n, i) => (i === idx ? { ...n, ...patch } : n)));
  }, []);

  const removeNote = useCallback((idx: number) => {
    setNotes((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  /**
   * Multi-page PDFs ask which page to use. The UI registers the picker
   * (thumbnails → chosen 1-based page, or null when cancelled).
   */
  const pdfPickerRef = useRef<((thumbs: string[], total: number) => Promise<number | null>) | null>(null);
  const setPdfPagePicker = useCallback((fn: typeof pdfPickerRef.current) => {
    pdfPickerRef.current = fn;
  }, []);
  const [importing, setImporting] = useState(false);

  /** Use a data-URL image as the own sketch background. */
  const applySketch = useCallback(
    (data: string) => {
      const im = new Image();
      im.onload = () => {
        // Very large photos/scans slow down drawing and fill the browser's
        // storage. Cap the longer side at 4000 px (still sharp for print).
        const MAX_SIDE = 4000;
        const big = Math.max(im.naturalWidth, im.naturalHeight);
        if (big > MAX_SIDE || data.length > 4_000_000) {
          const f = Math.min(1, MAX_SIDE / big);
          const c = document.createElement('canvas');
          c.width = Math.round(im.naturalWidth * f);
          c.height = Math.round(im.naturalHeight * f);
          const x = c.getContext('2d');
          if (x) {
            x.fillStyle = '#ffffff';
            x.fillRect(0, 0, c.width, c.height);
            x.imageSmoothingQuality = 'high';
            x.drawImage(im, 0, 0, c.width, c.height);
            const smaller = c.toDataURL('image/jpeg', 0.9);
            if (smaller.length < data.length) {
              applySketch(smaller);
              return;
            }
          }
        }
        origRef.current = im;
        origDataRef.current = data;
        bgSourceRef.current = 'upload';
        setMapLocked(true);
        setMpp(null);
        setPMsg('');
        doBuild();
      };
      im.onerror = () => setPMsg(tr('Ezt a képet nem sikerült megnyitni.'));
      im.src = data;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doBuild]
  );

  const loadImageFile = useCallback(
    async (file: File) => {
      // Validate before reading: the drag-and-drop path bypasses the picker's
      // accept filter entirely, and the result is embedded in the saved project,
      // so an oversized or unsupported file must never reach the reader.
      if (isPdf(file)) {
        if (file.size > PDF_MAX_BYTES) {
          setPMsg(tr('A PDF túl nagy (legfeljebb 40 MB lehet).'));
          return;
        }
        setImporting(true);
        setPMsg(tr('PDF feldolgozása…'));
        try {
          const doc = await openPdf(file);
          let pageNo = 1;
          if (doc.numPages > 1) {
            const shown = Math.min(doc.numPages, 24);
            const thumbs: string[] = [];
            for (let n = 1; n <= shown; n++) thumbs.push(await renderPdfPage(doc, n, 260));
            const picked = pdfPickerRef.current ? await pdfPickerRef.current(thumbs, doc.numPages) : 1;
            if (!picked) {
              setPMsg('');
              return;
            }
            pageNo = picked;
          }
          // Longest side ~3200 px: sharp line work, still small enough to save.
          const data = await renderPdfPage(doc, pageNo, 3200);
          doc.destroy();
          applySketch(data);
        } catch {
          setPMsg(tr('Ezt a PDF-et nem sikerült megnyitni (sérült vagy jelszóval védett lehet).'));
        } finally {
          setImporting(false);
        }
        return;
      }
      const MAX_BYTES = 12 * 1024 * 1024;
      if (!file.type.startsWith('image/')) {
        setPMsg(tr('Csak képet (JPG, PNG, WEBP) vagy PDF-et lehet háttérként betölteni.'));
        return;
      }
      if (file.size > MAX_BYTES) {
        setPMsg(tr('A kép túl nagy (legfeljebb 12 MB lehet).'));
        return;
      }
      const r = new FileReader();
      r.onload = () => {
        const data = r.result as string;
        if (typeof data !== 'string' || !/^data:image\//i.test(data)) {
          setPMsg(tr('Ezt a képet nem sikerült beolvasni.'));
          return;
        }
        applySketch(data);
      };
      r.onerror = () => setPMsg(tr('A fájlt nem sikerült beolvasni.'));
      r.readAsDataURL(file);
    },
    [applySketch]
  );

  /**
   * Freeze the current Google map view as the background image so drawings,
   * exports, saves and laps all work exactly like with an uploaded photo.
   */
  const lockMapFromGoogle = useCallback(
    (cap: { dataUrl: string; view: MapView; displayW: number; metersPerCssPx: number }) =>
      new Promise<boolean>((resolve) => {
        const im = new Image();
        im.onload = () => {
          origRef.current = im;
          origDataRef.current = cap.dataUrl;
          bgSourceRef.current = 'google';
          setMapView(cap.view);
          doBuild();
          const builtW = baseRef.current?.width || im.naturalWidth;
          // Canvas pixels span the same ground as the visible map, so the
          // scale bar is correct without manual calibration.
          setMpp((cap.metersPerCssPx * cap.displayW) / builtW);
          setMapLocked(true);
          setPMsg('');
          resolve(true);
        };
        im.onerror = () => resolve(false);
        im.src = cap.dataUrl;
      }),
    [doBuild]
  );

  /**
   * Match an empty canvas to the shape of the workspace, so the live map
   * (and the image captured from it) fills the available area. Only while
   * nothing depends on the current proportions: no background, no elements.
   */
  const [, setChTick] = useState(0);
  const setCanvasAspect = useCallback(
    (ar: number) => {
      if (origRef.current || stateRef.current.items.length) return;
      const h = Math.round(cw / Math.min(2.4, Math.max(1, ar)));
      if (Math.abs(h - chRef.current) < 2) return;
      chRef.current = h;
      setChTick((t) => t + 1);
      setTimeout(render, 0);
    },
    [cw, render]
  );

  /** Size the canvas backing store for crisp output (called by MapCanvas). */
  const setCanvasResolution = useCallback(
    (pr: number) => {
      const cv = canvasRef.current;
      if (!cv) return;
      const w = Math.round(cw * pr);
      const h = Math.round(chRef.current * pr);
      if (cv.width !== w || cv.height !== h) {
        cv.width = w;
        cv.height = h;
      }
      prRef.current = w / cw;
      render();
    },
    [cw, render]
  );

  /** Drop the frozen map image and return to the live, movable Google map. */
  const unlockMap = useCallback(() => {
    if (
      origDataRef.current &&
      !window.confirm(
        bgSourceRef.current === 'upload'
          ? tr('A feltöltött vázlat lekerül, és a Google térképre váltasz. A rajzok megmaradnak. Folytatod?')
          : tr('A rögzített háttérkép törlődik, és újra mozgatható lesz a Google térkép. A rajzok megmaradnak. Folytatod?')
      )
    ) {
      return;
    }
    origRef.current = null;
    origDataRef.current = null;
    bgSourceRef.current = null;
    baseRef.current = null;
    setMapLocked(false);
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setTimeout(render, 0);
  }, [render]);

  const setAutoEnhance = useCallback(() => {
    setEnhance({ eSh: 60, eCo: 108, eSa: 115, eBr: 100, eUp: true });
  }, []);

  const resetEnhance = useCallback(() => {
    setEnhance({ eSh: 0, eCo: 100, eSa: 100, eBr: 100, eUp: false });
  }, []);

  const exportPng = useCallback(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    setSelItem(null);
    mouseRef.current = null;
    curRef.current = [];
    setTimeout(() => {
      const out = makeExportCanvas();
      out.toBlob((b) => {
        if (!b) return;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(b);
        a.download = exportFileName('png');
        a.click();
      });
    }, 30);
  }, [render]);

  const exportPdf = useCallback(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    setSelItem(null);
    mouseRef.current = null;
    curRef.current = [];
    setTimeout(() => {
      const out = makeExportCanvas();
      // The PDF embeds the image with DCTDecode, so it must be real JPEG bytes.
      // JPEG has no alpha channel, so flatten onto white first.
      const flat = document.createElement('canvas');
      flat.width = out.width;
      flat.height = out.height;
      const fctx = flat.getContext('2d');
      if (!fctx) return;
      fctx.fillStyle = '#ffffff';
      fctx.fillRect(0, 0, flat.width, flat.height);
      fctx.drawImage(out, 0, 0);
      flat.toBlob(async (b) => {
        if (!b) return;
        const jpeg = new Uint8Array(await b.arrayBuffer());
        const imgW = flat.width;
        const imgH = flat.height;
        // Pick A4 orientation to match the map.
        const landscape = imgW > imgH;
        const pageW = landscape ? 842 : 595;
        const pageH = landscape ? 595 : 842;
        const ratio = Math.min(pageW / imgW, pageH / imgH);
        const drawW = imgW * ratio;
        const drawH = imgH * ratio;
        const pdf = buildPdf(
          {
            jpeg,
            pixelW: imgW,
            pixelH: imgH,
            x: (pageW - drawW) / 2,
            y: (pageH - drawH) / 2,
            w: drawW,
            h: drawH,
          },
          pageW,
          pageH,
        );
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([pdf], { type: 'application/pdf' }));
        a.download = exportFileName('pdf');
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      }, 'image/jpeg', 0.92);
    }, 30);
  }, [render]);

  const printMap = useCallback(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    setSelItem(null);
    mouseRef.current = null;
    curRef.current = [];
    setTimeout(() => {
      const out = makeExportCanvas();
      out.toBlob((b) => {
        if (!b) return;
        const r = new FileReader();
        r.onload = () => {
          const url = r.result as string;
          const w = window.open('', '_blank');
          if (!w) return;
          const doc = w.document;
          // Build the print document with DOM APIs only. The project name is
          // untrusted (it can arrive from a stored project or an imported file),
          // so it is never interpolated into markup.
          doc.title = projectName || 'COMPANY MOVE – Location Map Maker';
          const style = doc.createElement('style');
          style.textContent =
            '@page{margin:12mm}body{margin:0;display:flex;justify-content:center;align-items:center;min-height:100vh;background:#fff}' +
            'img{max-width:100%;max-height:100vh;object-fit:contain}';
          doc.head.appendChild(style);
          const img = doc.createElement('img');
          img.addEventListener('load', () => {
            setTimeout(() => w.print(), 200);
          });
          img.src = url;
          doc.body.appendChild(img);
        };
        r.readAsDataURL(b);
      }, 'image/png');
    }, 30);
  }, [render, projectName]);

  const saveCurrent = useCallback(async () => {
    const n = canonicalName(projectName) || tr('Névtelen');
    setProjectName(n);
    const snap = { ...snapshot(), name: n };
    setSaveState('saving');
    const ok = await saveProject(snap);
    // Only report success once the request has actually completed.
    setSaveState(ok ? 'saved' : 'error');
    if (ok) setLastModified(snap.t);
    setPMsg(ok ? '' : tr('A mentés nem sikerült (a felhő tárhely nem elérhető). Fájlba mentéssel biztonságban tudhatod a munkát.'));
    refreshProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectName, snapshot, refreshProjects]);

  const newProject = useCallback(() => {
    if (!confirm(tr('Új, üres projektet kezdesz? (A mentett projektek megmaradnak.)'))) return;
    restore(makeEmptyState(tr('Új projekt')));
    const freshLap: LapData = { id: 'lap-1', name: tr('{n}. nap', { n: 1 }), items: [], notes: [], panels: emptyPanels(), title: tr('FORGATÁSI HELYSZÍN TÉRKÉP'), sub: tr('Város, utca, helyszín neve, irányítószám') };
    setLaps([freshLap]);
    lapIdRef.current = 'lap-1';
    setActiveLapId('lap-1');
    setPMsg('');
  }, [restore]);

  const openProject = useCallback(
    async (name: string) => {
      const ok = await storageAvailable();
      if (!ok) return;
      const all = await listProjects();
      const wanted = canonicalName(name).toLowerCase();
      const p = all.find((x) => canonicalName(x.name || '').toLowerCase() === wanted);
      if (p && isValidMapState(p)) {
        restore(p);
        setProjectName(canonicalName(p.name));
        setSaveState('saved');
        setPMsg('');
      } else {
        setPMsg(tr('Ezt a projektet nem sikerült megnyitni.'));
      }
    },
    [restore]
  );

  const removeProject = useCallback(
    async (name: string) => {
      await deleteProject(name);
      refreshProjects();
    },
    [refreshProjects]
  );

  const exportJson = useCallback(() => {
    const blob = new Blob([JSON.stringify(snapshot())], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (projectName.trim() || 'projekt') + '.json';
    a.click();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectName]);

  const importJson = useCallback(
    (file: File) => {
      const r = new FileReader();
      r.onload = () => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(r.result as string);
        } catch {
          setPMsg(tr('A fájl nem érvényes projektfájl.'));
          return;
        }
        if (!isValidMapState(parsed)) {
          setPMsg(tr('A fájl nem érvényes projektfájl.'));
          return;
        }
        try {
          restore(parsed);
          setPMsg(tr('Projekt betöltve fájlból.'));
        } catch {
          setPMsg(tr('A fájl nem érvényes projektfájl.'));
        }
      };
      r.onerror = () => setPMsg(tr('A fájlt nem sikerült beolvasni.'));
      r.readAsText(file);
    },
    [restore]
  );

  const setArrowText = useCallback(
    (txt: string) => {
      if (selItem && selItem.kind === 'arrow') {
        const updated = { ...selItem, txt };
        setSelItem(updated);
        setItems((prev) => prev.map((i) => (i === selItem ? updated : i)));
      }
    },
    [selItem]
  );

  const setArrowColor = useCallback(
    (col: string) => {
      if (selItem && selItem.kind === 'arrow') {
        const updated = { ...selItem, col };
        setSelItem(updated);
        setItems((prev) => prev.map((i) => (i === selItem ? updated : i)));
      }
    },
    [selItem]
  );

  // history tracking: debounced snapshot of items changes
  useEffect(() => {
    if (skipHistRef.current) {
      skipHistRef.current = false;
      prevItemsRef.current = items;
      return;
    }
    if (items === prevItemsRef.current) return;
    if (histTimerRef.current) clearTimeout(histTimerRef.current);
    histTimerRef.current = setTimeout(() => {
      histRef.current.past.push(prevItemsRef.current);
      if (histRef.current.past.length > 50) histRef.current.past.shift();
      histRef.current.future = [];
      prevItemsRef.current = items;
      setCanUndo(histRef.current.past.length > 0);
      setCanRedo(false);
    }, 500);
  }, [items]);

  // keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceRef.current = e.type === 'keydown';
      const el = e.target as HTMLElement;
      const inField =
        el.tagName === 'TEXTAREA' ||
        (el.tagName === 'INPUT' && (el as HTMLInputElement).type !== 'checkbox' && (el as HTMLInputElement).type !== 'radio');
      if (e.type === 'keyup') return;
      if (inField) return;

      const mod = e.ctrlKey || e.metaKey;

      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
      if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); redo(); return; }
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); saveCurrent(); return; }
      if (mod && e.key.toLowerCase() === 'e') { e.preventDefault(); exportPng(); return; }
      if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); changeZoom(0.1); return; }
      if (mod && e.key === '-') { e.preventDefault(); changeZoom(-0.1); return; }
      if (mod && e.key === '0') { e.preventDefault(); fitView(); return; }

      if (e.key === 'Enter') { finish(); return; }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selItem) {
        e.preventDefault();
        if (selItem.locked) return;
        setItems((prev) => prev.filter((i) => i !== selItem));
        setSelItem(null);
        return;
      }
      if (e.key === 'Escape') {
        curRef.current = [];
        dragRef.current = null;
        setSelItem(null);
        render();
        return;
      }

      if (!mod && e.key.startsWith('Arrow')) {
        // Arrow keys move around the map.
        e.preventDefault();
        const step = (e.shiftKey ? 240 : 80) * (cw / 1500);
        const d = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key];
        if (d) setPan((pp) => ({ x: pp.x + d[0], y: pp.y + d[1] }));
        return;
      }

      const toolKeys: Record<string, Tool> = {
        v: 'sel', p: 'free', b: 'poly', r: 'rect', l: 'path',
        a: 'arrow', t: 'tarrow', f: 'fpath', m: 'scale',
      };
      const tk = toolKeys[e.key.toLowerCase()];
      if (tk) { setToolAction(tk); return; }

      if (e.key === 'h' && selItem) { e.preventDefault(); const idx = items.indexOf(selItem); if (idx >= 0) toggleItemHidden(idx); return; }
      if ((e.key === 'r' || e.key === 'R') && !mod && selItem) { rotateSel90(); return; }
    };
    window.addEventListener('keydown', handler);
    window.addEventListener('keyup', handler);
    return () => {
      window.removeEventListener('keydown', handler);
      window.removeEventListener('keyup', handler);
    };
  }, [finish, selItem, render, undo, redo, saveCurrent, exportPng, changeZoom, fitView, setToolAction, rotateSel90, toggleItemHidden, items]);

  return {
    canvasRef,
    cw,
    ch: chRef.current,
    zoom,
    pan,
    setZoom,
    setPan,
    changeZoom,
    zoomTo,
    wheelZoom,
    fitView,
    types,
    sel,
    items,
    notes,
    panels,
    title,
    sub,
    projectName,
    tool,
    selItem,
    tCol,
    display,
    enhance,
    range,
    autoSel,
    googleMapActive,
    setGoogleMapActive,
    mapView,
    setMapView,
    mapLocked,
    setMapLocked,
    lockMapFromGoogle,
    unlockMap,
    captureLabels,
    setCaptureLabels,
    setCanvasAspect,
    setCanvasResolution,
    setPMsg,
    projects,
    pMsg,
    storageOk,
    origImg: !!origDataRef.current,
    scaleMeters: scaleMetersUi,
    bgImage: origDataRef.current,
    bgSource: bgSourceRef.current,
    focusSel: focusSelRef.current,
    setSel,
    setTool: setToolAction,
    setTCol,
    setDisplay,
    setEnhance,
    setRange,
    setAutoSel,
    setTitle,
    setSub,
    setProjectName,
    setScaleMeters: (m: number) => {
      scaleMetersRef.current = m;
      setScaleMetersUi(m);
    },
    addType,
    removeType,
    updateType,
    undo,
    redo,
    canUndo,
    canRedo,
    clearAll,
    laps,
    activeLapId,
    switchLap,
    addLap,
    duplicateLap,
    deleteLap,
    renameLap,
    removeItem,
    rotateSel90,
    resetPanels,
    updatePanelStyle,
    setLayerHidden,
    duplicateItem,
    saveState,
    lastModified,
    mpp,
    addNote,
    updateNote,
    removeNote,
    loadImageFile,
    setPdfPagePicker,
    importing,
    setAutoEnhance,
    resetEnhance,
    exportPng,
    exportPdf,
    printMap,
    saveCurrent,
    newProject,
    openProject,
    removeProject,
    exportJson,
    importJson,
    setArrowText,
    setArrowColor,
    toggleItemHidden,
    selectItem,
    updateSelItem,
    moveItem,
    finish,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onDblClick,
    cancelDraw: () => {
      curRef.current = [];
      dragRef.current = null;
      render();
    },
    consumeFocusSel: () => {
      focusSelRef.current = false;
    },
  };
}

export type EditorApi = ReturnType<typeof useMapEditor>;
