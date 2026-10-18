export type Point = [number, number];

export type BgSource = 'google' | 'upload' | null;

export interface ZoneType {
  id: number;
  name: string;
  desc: string;
  color: string;
  fg?: string; // label text colour (auto when unset)
  lbg?: string; // label bubble colour (zone colour when unset)
}

export type ItemKind = 'poly' | 'path' | 'arrow';

export interface MapItem {
  kind: ItemKind;
  pts: Point[];
  type?: number; // for poly
  rot?: number; // rotation radians
  rect?: boolean; // is rectangle (poly)
  col?: string; // arrow color
  txt?: string; // arrow text
  fg?: string; // arrow label text colour (auto when unset)
  ent?: boolean; // entrance arrow
  hidden?: boolean; // layer visibility
  locked?: boolean; // cannot be moved / rotated / deleted on the canvas
  // Optional production details (all additive; older saves simply lack them)
  name?: string; // own name, e.g. "SET 1" (falls back to the category name)
  addr?: string; // address shown under the name
  desc?: string; // description
  note?: string; // free-form note
  contact?: string; // contact person
  phone?: string; // phone number
}

export interface PanelPos {
  fx: number | null;
  fy: number | null;
  bg?: string; // box colour (title / legend)
  fg?: string; // text colour, or the symbol colour for north arrow / scale bar
}

export interface Note {
  t: string; // title
  x: string; // body
  a: number; // bg opacity 0-100
  z: number; // font size 60-180
  fx: number | null;
  fy: number | null;
  bg?: string;
  fg?: string;
  hidden?: boolean; // hidden via the "Megjegyzések" layer
}

export interface Panels {
  title: PanelPos;
  legend: PanelPos;
  north: PanelPos;
  scale: PanelPos;
}

export interface MapView {
  lat: number;
  lng: number;
  zoom: number;
  satellite: boolean;
}

export interface MapState {
  v: 1;
  t: number;
  pn: string;
  title: string;
  sub: string;
  types: ZoneType[];
  nextId: number;
  sel: number;
  items: MapItem[];
  panels: Panels;
  notes: Note[];
  mpp: number | null; // meters per pixel
  cw: number; // canvas width
  img: string | null; // data url
  mapView?: MapView;
  mapLocked?: boolean;
  /** Where the background image came from (labels/UI only). */
  bgSource?: BgSource;
  laps?: LapData[];
  activeLapId?: string;
}

export interface LapData {
  id: string;
  name: string;
  items: MapItem[];
  notes: Note[];
  panels: Panels;
  title: string;
  sub: string;
  img?: string | null;
  cw?: number;
  ch?: number;
  mpp?: number | null;
  mapView?: MapView;
  bgSource?: BgSource;
}

export interface ProjectState extends MapState {
  name: string;
  auto?: boolean;
  laps?: LapData[];
  activeLapId?: string;
}

export type Tool =
  | 'sel'
  | 'free'
  | 'fpath'
  | 'poly'
  | 'rect'
  | 'path'
  | 'arrow'
  | 'tarrow'
  | 'scale';

export interface DisplayOpts {
  oLegend: boolean;
  oNorth: boolean;
  oScale: boolean;
  oLabels: boolean;
  oFill: boolean;
}

export interface EnhanceOpts {
  eSh: number;
  eCo: number;
  eSa: number;
  eBr: number;
  eUp: boolean;
}

export interface RangeOpts {
  aT: number;
  aL: number;
  sm: number;
}
