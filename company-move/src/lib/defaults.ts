import { t as tr } from '@/lib/i18n';
import type { Panels, PanelPos, ZoneType, MapState, MapView } from '@/types';

export const DEFAULT_MAP_VIEW: MapView = {
  lat: 47.4979,
  lng: 19.0402,
  zoom: 15,
  satellite: true,
};

/** Default categories for a new project, in the current UI language. */
export const DEFAULT_TYPES = (): ZoneType[] => [
  { id: 1, name: tr('BÁZIS'), desc: tr('Stáb bázis, pihenő, catering, smink, öltöző'), color: '#e5484d' },
  { id: 2, name: 'SET 1', desc: tr('Forgatási helyszín'), color: '#3478d4' },
  {
    id: 3,
    name: tr('TECHNIKAI + NAGY BUSZ PARKOLÓ'),
    desc: tr('Technikai járművek, buszok parkolója'),
    color: '#c044c9',
  },
  { id: 4, name: tr('STÁB PARKOLÓ'), desc: tr('Stáb autók, személyautók'), color: '#e7b547' },
  { id: 5, name: 'WC', desc: tr('Épületen belül (WC)'), color: '#299764' },
];

/** Route line colour: cyan, readable on satellite and road maps alike. */
export const PATH_COLOR = '#22d3ee';

export const PALETTE = ['#ff8a00', '#00c2ff', '#8a2be2', '#ffffff'];

export const DEFAULT_TITLE = () => tr('FORGATÁSI HELYSZÍN TÉRKÉP');
export const DEFAULT_SUB = () => tr('Város, utca, helyszín neve, irányítószám');

export const TOOL_HINTS: Record<string, string> = {
  tarrow:
    'Húzz egy nyilat a kezdőponttól a végpontig (vagy kattints a két pontra), utána a jobb oldali panelen beírhatod a szövegét, és átszínezheted.',
  sel: 'Üres helyen húzva a térképet mozgatod, görgővel nagyítasz. Kattints bármelyik zónára, útvonalra vagy nyílra: húzással mozgatod, a ⟳ fogantyúval forgatod (Shift = 15°-os lépések, Delete = törlés). Téglalapnál a sarkokon és oldalakon lévő négyzetekkel átméretezheted. A címtábla és a jelmagyarázat bármelyik eszköznél húzható.',
  free: 'Rajzold körbe a területet egérrel vagy ujjal – elengedéskor szép, egyenes élű zónává alakul (aktív zónatípus színével).',
  fpath: 'Húzz végig egy vonalat – sima, nyilas útvonallá alakul.',
  poly: 'Kattints a sarokpontokra, dupla kattintás vagy Enter zárja le a zónát.',
  rect: 'Húzd végig az egeret az átlón a téglalaphoz.',
  path: 'Kattints az útvonal pontjaira, dupla kattintás vagy Enter a befejezéshez.',
  arrow: 'Húzd a nyilat a bejárat helyétől a behajtás irányába, vagy kattints a kezdőpontra, majd a nyíl hegyére. Esc: mégse.',
  scale: 'Kattints két ismert távolságú pontra (pl. egy épület két vége).',
};

export function makeEmptyState(pn = tr('Új projekt')): MapState {
  return {
    v: 1,
    t: Date.now(),
    pn,
    title: DEFAULT_TITLE(),
    sub: DEFAULT_SUB(),
    types: DEFAULT_TYPES(),
    nextId: 6,
    sel: 1,
    items: [],
    panels: emptyPanels(),
    notes: [],
    mpp: null,
    cw: 1500,
    img: null,
    mapView: { ...DEFAULT_MAP_VIEW },
    mapLocked: false,
  };
}

const pos = (p?: Partial<PanelPos> | null): PanelPos => {
  const out: PanelPos = { fx: p?.fx ?? null, fy: p?.fy ?? null };
  if (p?.bg) out.bg = p.bg;
  if (p?.fg) out.fg = p.fg;
  return out;
};

export function emptyPanels(): Panels {
  return { title: pos(), legend: pos(), north: pos(), scale: pos() };
}

/** Fresh copy of the panels, tolerating older saves without north/scale. */
export function normalizePanels(p?: Partial<Panels> | null): Panels {
  return { title: pos(p?.title), legend: pos(p?.legend), north: pos(p?.north), scale: pos(p?.scale) };
}

/** Panels reset to their default spot, keeping the chosen colours. */
export function resetPanelPositions(p: Panels): Panels {
  const n = normalizePanels(p);
  (Object.keys(n) as (keyof Panels)[]).forEach((k) => {
    n[k].fx = null;
    n[k].fy = null;
  });
  return n;
}
