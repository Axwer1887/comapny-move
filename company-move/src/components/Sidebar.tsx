import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { dt, locale, t as tr } from '@/lib/i18n';
import {
  ArrowRight,
  ChevronDown,
  Eye,
  EyeOff,
  FilePlus2,
  FileUp,
  FolderOpen,
  Image as ImageIcon,
  Layers,
  LayoutGrid,
  Map as MapIcon,
  MessageSquareText,
  Plus,
  RotateCcw,
  Ruler,
  Route,
  Save,
  Search,
  Settings2,
  SlidersHorizontal,
  Spline,
  Trash2,
  Type,
  Upload,
  Wand2,
  Wrench,
  X,
} from 'lucide-react';
import type { EditorApi } from '@/hooks/useMapEditor';
import type { ZoneType } from '@/types';
import { PATH_COLOR, TOOL_HINTS } from '@/lib/defaults';
import { categoryIcon, readableOn } from '@/lib/categories';

interface Props {
  api: EditorApi;
}

const OPEN_KEY = 'forgterkep.ui.sections';
const DEFAULT_OPEN: Record<string, boolean> = {
  project: true,
  layers: true,
  labels: false,
  background: true,
  enhance: true,
  display: false,
  tools: false,
};

function useSectionState() {
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    try {
      const raw = localStorage.getItem(OPEN_KEY);
      if (raw) return { ...DEFAULT_OPEN, ...JSON.parse(raw) };
    } catch {
      /* storage unavailable */
    }
    return DEFAULT_OPEN;
  });
  useEffect(() => {
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify(open));
    } catch {
      /* ignore */
    }
  }, [open]);
  return [open, (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }))] as const;
}

export default function Sidebar({ api }: Props) {
  const [open, toggle] = useSectionState();

  // Tool-specific settings belong in view while that tool is in use.
  const needsTools = api.tool === 'tarrow' || api.tool === 'scale';
  const toolsOpen = open.tools || needsTools;

  return (
    <div className="sb-scroll">
      <Section id="project" title={tr('Projekt')} icon={<Layers size={16} />} open={open.project} onToggle={toggle}>
        <ProjectSection api={api} />
      </Section>

      <Section
        id="layers"
        title={tr('Rétegek')}
        icon={<LayoutGrid size={16} />}
        open={open.layers}
        onToggle={toggle}
        action={
          <button type="button" className="sb-head-action" onClick={api.addType} title={tr('Új kategória (zónatípus)')} aria-label={tr('Új kategória')}>
            <Plus size={15} />
          </button>
        }
      >
        <LayersSection api={api} />
      </Section>

      <Section id="labels" title={tr('Feliratok')} icon={<Type size={16} />} open={open.labels} onToggle={toggle}>
        <LabelsSection api={api} />
      </Section>

      <Section id="background" title={tr('Háttérkép')} icon={<ImageIcon size={16} />} open={open.background} onToggle={toggle}>
        <BackgroundSection api={api} />
      </Section>

      <Section id="enhance" title={tr('Képjavítás')} icon={<SlidersHorizontal size={16} />} open={open.enhance} onToggle={toggle}>
        <EnhanceSection api={api} />
      </Section>

      <Section id="display" title={tr('Térképelemek')} icon={<Settings2 size={16} />} open={open.display} onToggle={toggle}>
        <DisplaySection api={api} />
      </Section>

      <Section id="tools" title={tr('Eszközbeállítások')} icon={<Wrench size={16} />} open={toolsOpen} onToggle={toggle}>
        <ToolsSection api={api} />
      </Section>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Section({
  id,
  title,
  icon,
  open,
  onToggle,
  action,
  children,
}: {
  id: string;
  title: string;
  icon: ReactNode;
  open: boolean;
  onToggle: (id: string) => void;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={`sb-section ${open ? '' : 'closed'}`}>
      <div className="sb-section-head">
        <button type="button" className="sb-section-toggle" onClick={() => onToggle(id)} aria-expanded={open}>
          {icon}
          {title}
          <ChevronDown size={16} className="chev" />
        </button>
        {action}
      </div>
      <div className="sb-section-body">{children}</div>
    </section>
  );
}

const fmtDateTime = (t: number) =>
  new Date(t).toLocaleString(locale(), { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

const SAVE_LABEL: Record<EditorApi['saveState'], string> = {
  idle: 'Még nincs mentve a felhőbe',
  dirty: 'Módosítások vannak',
  saving: 'Mentés folyamatban…',
  saved: 'Mentve',
  error: 'Mentési hiba',
};

function ProjectSection({ api }: { api: EditorApi }) {
  const [browse, setBrowse] = useState(false);
  const [search, setSearch] = useState('');
  const importRef = useRef<HTMLInputElement | null>(null);
  const isErr = /nem sikerült|hiba|nem érhető|nem elérhető|túl nagy|could not|failed|error|unavailable|not available|too large/i.test(api.pMsg);
  // Informational messages ("Legutóbbi munka visszatöltve.") fade after a while.
  useEffect(() => {
    if (!api.pMsg || isErr) return undefined;
    const t = setTimeout(() => api.setPMsg(''), 6000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api.pMsg]);
  const filtered = useMemo(
    () => api.projects.filter((p) => p.name.toLowerCase().includes(search.trim().toLowerCase())),
    [api.projects, search],
  );

  return (
    <div className="sb-stack">
      <div className="sb-card project-card">
        <div className="project-card-main">
          <input
            className="project-name"
            value={dt(api.projectName)}
            onChange={(e) => api.setProjectName(e.target.value)}
            aria-label={tr('Projekt neve')}
          />
          <div className="project-meta">
            {api.lastModified ? tr('Módosítva: {v0}', { v0: fmtDateTime(api.lastModified) }) : tr('Még nincs módosítás')}
          </div>
          <div className={`save-status ${api.saveState}`} role="status">
            <i /> {tr(SAVE_LABEL[api.saveState])}
          </div>
        </div>
      </div>

      <button
        type="button"
        className="btn btn-primary btn-lg btn-block"
        onClick={api.saveCurrent}
        disabled={api.saveState === 'saving'}
        title={tr('Mentés a felhőbe (Ctrl+S)')}
      >
        <Save size={17} /> {api.saveState === 'saving' ? tr('Mentés…') : tr('Mentés')}
      </button>

      <div className="sb-row">
        <button type="button" className="btn" onClick={api.newProject} title={tr('Új, üres projekt')}>
          <FilePlus2 size={15} /> {tr('Új')}
        </button>
        <button type="button" className={`btn ${browse ? 'btn-primary' : ''}`} onClick={() => setBrowse((b) => !b)} aria-expanded={browse} title={tr('Mentett projekt megnyitása')}>
          <FolderOpen size={15} /> {tr('Megnyitás')}
        </button>
        <button type="button" className="btn" onClick={() => importRef.current?.click()} title={tr('Projektfájl (.json) importálása')}>
          <FileUp size={15} /> {tr('Import')}
        </button>
        <input
          ref={importRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) api.importJson(f);
            e.target.value = '';
          }}
        />
      </div>

      {api.pMsg && <p className={`sb-msg ${isErr ? 'err' : ''}`} role="status">{api.pMsg}</p>}
      {!api.storageOk && <p className="sb-msg err">{tr('A felhő tárhely nem elérhető. A munkát a böngésző automatikusan megőrzi, és fájlba is exportálhatod.')}</p>}

      {browse && (
        <div>
          {api.projects.length > 3 && (
            <label className="search-field">
              <Search size={14} />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tr('Projekt keresése…')} aria-label={tr('Projekt keresése')} />
            </label>
          )}
          <div className="project-list">
            {api.projects.length === 0 && <p className="sb-sub">{tr('Még nincs mentett projekt a felhőben.')}</p>}
            {api.projects.length > 0 && filtered.length === 0 && <p className="sb-sub">{tr('Nincs találat.')}</p>}
            {filtered.map((p) => (
              <div key={p.name} className={`project-item ${p.name === api.projectName ? 'active' : ''}`}>
                <button
                  type="button"
                  className="layer-main"
                  onClick={() => {
                    api.openProject(p.name);
                    setBrowse(false);
                  }}
                >
                  <FolderOpen size={15} />
                  <span className="project-item-body">
                    <strong>{p.name}</strong>
                    <span>
                      {tr('{n} elem', { n: p.count })} · {new Date(p.t).toLocaleDateString(locale(), { month: 'short', day: 'numeric' })}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  className="icon-btn danger"
                  title={tr('Projekt törlése')}
                  onClick={() => {
                    if (confirm(tr('Biztosan törlöd a(z) „{v0}” projektet a felhőből?', { v0: p.name }))) api.removeProject(p.name);
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function LayersSection({ api }: { api: EditorApi }) {
  const [editing, setEditing] = useState<number | null>(null);
  const count = (pred: (i: (typeof api.items)[number]) => boolean) => api.items.filter(pred).length;
  const allHidden = (pred: (i: (typeof api.items)[number]) => boolean) => {
    const xs = api.items.filter(pred);
    return xs.length > 0 && xs.every((i) => i.hidden);
  };
  const paths = (i: (typeof api.items)[number]) => i.kind === 'path';
  const arrows = (i: (typeof api.items)[number]) => i.kind === 'arrow';
  const nPaths = count(paths);
  const nArrows = count(arrows);
  const notesHidden = api.notes.length > 0 && api.notes.every((n) => n.hidden);

  return (
    <>
      <div className="layers" role="list">
        {api.types.map((t) => {
          const pred = (i: (typeof api.items)[number]) => i.kind === 'poly' && i.type === t.id;
          const n = count(pred);
          const off = allHidden(pred);
          const Icon = categoryIcon(t.name);
          const active = t.id === api.sel;
          return (
            <div key={t.id} role="listitem">
              <div className={`layer ${active ? 'active' : ''} ${off ? 'off' : ''}`}>
                <LayerEye off={off} disabled={n === 0} onClick={() => api.setLayerHidden(t.id, !off)} name={dt(t.name)} />
                <button
                  type="button"
                  className="layer-main"
                  onClick={() => api.setSel(t.id)}
                  title={active ? tr('Ezzel a kategóriával rajzolsz') : tr('Kattints: ezzel a kategóriával rajzolj')}
                >
                  <span className="layer-dot" style={{ background: t.color }} />
                  <span className="layer-name">{dt(t.name)}</span>
                  {active && <span className="layer-tag">{tr('AKTÍV')}</span>}
                  <span className="layer-count">{tr('{n} elem', { n: n })}</span>
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => setEditing(editing === t.id ? null : t.id)}
                  title={tr('Kategória szerkesztése')}
                  aria-expanded={editing === t.id}
                >
                  <Icon size={15} />
                </button>
              </div>
              {editing === t.id && (
                <TypeEditor
                  t={t}
                  onChange={(patch) => api.updateType(t.id, patch)}
                  onDelete={
                    api.types.length > 1
                      ? () => {
                          const msg = n ? tr('A(z) „{v0}” kategória és {v1} eleme törlődik. Folytatod?', { v0: t.name, v1: n }) : tr('Törlöd a(z) „{v0}” kategóriát?', { v0: t.name });
                          if (confirm(msg)) {
                            api.removeType(t);
                            setEditing(null);
                          }
                        }
                      : undefined
                  }
                  onClose={() => setEditing(null)}
                />
              )}
            </div>
          );
        })}

        <div className={`layer ${allHidden(paths) ? 'off' : ''}`} role="listitem">
          <LayerEye off={allHidden(paths)} disabled={nPaths === 0} onClick={() => api.setLayerHidden('path', !allHidden(paths))} name="Útvonalak" />
          <span className="layer-main">
            <Route size={15} color={PATH_COLOR} />
            <span className="layer-name">{tr('Útvonalak')}</span>
            <span className="layer-count">{tr('{n} elem', { n: nPaths })}</span>
          </span>
        </div>
        {nArrows > 0 && (
          <div className={`layer ${allHidden(arrows) ? 'off' : ''}`} role="listitem">
            <LayerEye off={allHidden(arrows)} onClick={() => api.setLayerHidden('arrow', !allHidden(arrows))} name="Nyilak és feliratok" />
            <span className="layer-main">
              <ArrowRight size={15} color="#ff8a00" />
              <span className="layer-name">{tr('Nyilak és feliratok')}</span>
              <span className="layer-count">{tr('{n} elem', { n: nArrows })}</span>
            </span>
          </div>
        )}
        <div className={`layer ${notesHidden ? 'off' : ''}`} role="listitem">
          <LayerEye off={notesHidden} disabled={api.notes.length === 0} onClick={() => api.setLayerHidden('notes', !notesHidden)} name="Megjegyzések" />
          <span className="layer-main">
            <MessageSquareText size={15} color="#cbd5e1" />
            <span className="layer-name">{tr('Megjegyzések')}</span>
            <span className="layer-count">{tr('{n} elem', { n: api.notes.length })}</span>
          </span>
        </div>
      </div>
      <p className="sb-sub">{tr('Kattints egy kategóriára, hogy azzal rajzolj. A szem ikon a térképen és az exportban is elrejti a réteget.')}</p>
    </>
  );
}

function LayerEye({ off, disabled, onClick, name }: { off: boolean; disabled?: boolean; onClick: () => void; name: string }) {
  return (
    <button
      type="button"
      className="layer-eye"
      onClick={onClick}
      disabled={disabled}
      title={disabled ? tr('Még nincs eleme') : off ? tr('{v0} megjelenítése', { v0: tr(name) }) : tr('{v0} elrejtése', { v0: tr(name) })}
      aria-label={off ? tr('{v0} megjelenítése', { v0: tr(name) }) : tr('{v0} elrejtése', { v0: tr(name) })}
      aria-pressed={!off}
    >
      {off ? <EyeOff size={16} /> : <Eye size={16} />}
    </button>
  );
}

function TypeEditor({
  t,
  onChange,
  onDelete,
  onClose,
}: {
  t: ZoneType;
  onChange: (patch: Partial<ZoneType>) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  return (
    <div className="layer-editor sb-stack">
      <div className="sb-row" style={{ alignItems: 'center' }}>
        <input type="color" className="color-input square" value={t.color} onChange={(e) => onChange({ color: e.target.value })} title={tr('Kategória színe')} aria-label={tr('Kategória színe')} style={{ flex: 'none' }} />
        <input className="sb-input" value={dt(t.name)} onChange={(e) => onChange({ name: e.target.value })} aria-label={tr('Kategória neve')} />
        <button type="button" className="icon-btn" onClick={onClose} title={tr('Bezárás')} style={{ flex: 'none' }}><X size={14} /></button>
      </div>
      <input className="sb-input" value={dt(t.desc)} onChange={(e) => onChange({ desc: e.target.value })} placeholder={tr('Leírás a jelmagyarázatba')} aria-label={tr('Leírás')} />
      <ColorPair
        bgLabel="Címke háttere"
        fgLabel="Címke betűszíne"
        bg={t.lbg}
        fg={t.fg}
        bgDefault="#111b25"
        fgDefault={readableOn(t.lbg || '#111b25')}
        onChange={(patch) => onChange('bg' in patch ? { lbg: patch.bg } : { fg: patch.fg })}
      />
      {onDelete && (
        <button type="button" className="btn btn-sm btn-block" onClick={onDelete}>
          <Trash2 size={14} /> {tr('Kategória törlése')}
        </button>
      )}
    </div>
  );
}

function LabelsSection({ api }: { api: EditorApi }) {
  return (
    <div className="sb-stack">
      <label className="sb-label">{tr('Cím')}</label>
      <input className="sb-input" value={dt(api.title)} onChange={(e) => api.setTitle(e.target.value)} aria-label={tr('Cím')} />
      <label className="sb-label">{tr('Alcím')}</label>
      <input className="sb-input" value={dt(api.sub)} onChange={(e) => api.setSub(e.target.value)} aria-label={tr('Alcím')} />
      <ColorPair
        bgLabel="Címtábla színe"
        fgLabel="Betűszín"
        bg={api.panels.title.bg}
        fg={api.panels.title.fg}
        bgDefault="#ffffff"
        fgDefault="#14181f"
        onChange={(patch) => api.updatePanelStyle('title', patch)}
      />

      <p className="sb-subhead">{tr('Megjegyzések a térképen')}</p>
      {api.notes.map((n, i) => (
        <div key={i} className="note-card sb-stack">
          <div className="note-card-head">
            {tr('Megjegyzés {n}', { n: i + 1 })}
            <button type="button" className="icon-btn danger" onClick={() => api.removeNote(i)} title={tr('Megjegyzés törlése')}><Trash2 size={14} /></button>
          </div>
          <input className="sb-input" placeholder={tr('Címsor (pl. FONTOS)')} value={n.t} onChange={(e) => api.updateNote(i, { t: e.target.value })} />
          <textarea className="sb-input" rows={3} placeholder={tr('Felirat vagy extra infó: PARKOLÓ / RAKODÓ…')} value={n.x} onChange={(e) => api.updateNote(i, { x: e.target.value })} />
          <ColorPair
            bgLabel="Tábla színe"
            fgLabel="Betűszín"
            bg={n.bg}
            fg={n.fg}
            bgDefault="#ffffff"
            fgDefault="#14181f"
            onChange={(patch) => api.updateNote(i, 'bg' in patch ? { bg: patch.bg || '#ffffff' } : { fg: patch.fg || '#14181f' })}
          />
          <Slider label="Háttér" value={n.a} min={0} max={100} onChange={(v) => api.updateNote(i, { a: v })} format={(v) => `${v}%`} />
          <Slider label="Betűméret" value={n.z} min={60} max={180} onChange={(v) => api.updateNote(i, { z: v })} format={(v) => `${v}%`} />
        </div>
      ))}
      <button type="button" className="btn btn-block" onClick={api.addNote}>
        <Plus size={15} /> {tr('Új megjegyzés')}
      </button>
      <p className="sb-sub">{tr('A megjegyzéseket és a címtáblát a térképen húzással mozgathatod.')}</p>
    </div>
  );
}

function BackgroundSection({ api }: { api: EditorApi }) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const isUpload = api.bgSource === 'upload' && api.origImg;
  const hasGoogle = api.googleMapActive || api.bgSource === 'google';
  let title = tr('Nincs háttérkép');
  let detail = tr('Tölts fel saját térképvázlatot, vagy használd a Google térképet.');
  if (isUpload) {
    title = tr('Saját térképvázlat');
    detail = tr('Feltöltött kép – erre rajzolsz');
  } else if (api.origImg) {
    title = tr('Google Maps – rögzítve');
    detail = tr('A rajzok ehhez a nézethez igazodnak');
  } else if (api.googleMapActive) {
    title = tr('Google Maps – {v0}', { v0: api.mapView.satellite ? tr('Műhold') : tr('Térkép') });
    detail = tr('Élő nézet, még nincs rögzítve');
  }
  const pick = () => fileRef.current?.click();
  return (
    <div className="sb-stack">
      {hasGoogle && (
        <div className="seg" role="radiogroup" aria-label={tr('Háttér forrása')}>
          <button
            type="button"
            role="radio"
            aria-checked={!isUpload}
            className={!isUpload ? 'on' : ''}
            onClick={() => {
              if (isUpload) api.unlockMap(); // asks before removing the sketch
            }}
          >
            <MapIcon size={15} /> {tr('Google térkép')}
          </button>
          <button type="button" role="radio" aria-checked={Boolean(isUpload)} className={isUpload ? 'on' : ''} onClick={pick}>
            <ImageIcon size={15} /> {tr('Saját vázlat')}
          </button>
        </div>
      )}
      <div className="bg-source">
        <div className="bg-thumb" style={api.bgImage ? { backgroundImage: `url(${api.bgImage})` } : undefined}>
          {!api.bgImage && <ImageIcon size={18} style={{ margin: '11px auto', display: 'block', color: '#7d8b9b' }} />}
        </div>
        <div style={{ minWidth: 0 }}>
          <strong>{title}</strong>
          <span>{detail}</span>
        </div>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/bmp,application/pdf,.pdf"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) api.loadImageFile(f);
          e.target.value = '';
        }}
      />
      <button type="button" className="btn btn-block" onClick={pick} disabled={api.importing}>
        <Upload size={15} /> {isUpload ? tr('Másik vázlat feltöltése') : tr('Saját térképvázlat feltöltése')}
      </button>
      {isUpload && !api.mpp && (
        <div className="hint">
          {tr('Saját vázlatnál a lépték nem ismert. Állítsd be két ismert távolságú pont között, és a méretarány-vonal is megjelenik.')}
          <button type="button" className="btn btn-sm btn-block" style={{ marginTop: 8 }} onClick={() => api.setTool('scale')}>
            <Ruler size={14} /> {tr('Lépték beállítása')}
          </button>
        </div>
      )}
      {api.googleMapActive && !isUpload && (
        <label className="check" title={tr('Kikapcsolva tiszta térképet kapsz: a Google üzlet-, közlekedési ikonjai és feliratai nélkül')}>
          <input type="checkbox" checked={api.captureLabels} onChange={(e) => api.setCaptureLabels(e.target.checked)} />
          {tr('Utcanevek és feliratok a rögzített térképen')}
        </label>
      )}
      <p className="sb-sub">
        {tr('Vázlatként kép (JPG, PNG, WEBP, max. 12 MB) vagy PDF (max. 40 MB) is jó: rajz, fotó, alaprajz, beszkennelt helyszínrajz. Több oldalas PDF-nél kiválaszthatod az oldalt. A fájlt a térképre is húzhatod.')}
      </p>
    </div>
  );
}

function EnhanceSection({ api }: { api: EditorApi }) {
  const e = api.enhance;
  const set = (patch: Partial<typeof e>) => api.setEnhance({ ...e, ...patch });
  const signed = (v: number) => (v > 0 ? `+${v}` : `${v}`);
  return (
    <div className="sb-stack">
      {!api.origImg && <p className="sb-sub" style={{ marginTop: 0 }}>{tr('A képjavítás a háttérképre hat. Tölts fel vagy rögzíts egy térképet.')}</p>}
      <Slider label="Fényerő" value={e.eBr} min={70} max={140} onChange={(v) => set({ eBr: v })} format={(v) => signed(v - 100)} />
      <Slider label="Kontraszt" value={e.eCo} min={70} max={150} onChange={(v) => set({ eCo: v })} format={(v) => signed(v - 100)} />
      <Slider label="Telítettség" value={e.eSa} min={50} max={170} onChange={(v) => set({ eSa: v })} format={(v) => signed(v - 100)} />
      <Slider label="Élesség" value={e.eSh} min={0} max={100} onChange={(v) => set({ eSh: v })} format={(v) => `${v}`} />
      <label className="check">
        <input type="checkbox" checked={e.eUp} onChange={(ev) => set({ eUp: ev.target.checked })} />
        {tr('2× felbontás (finomabb nagyítás)')}
      </label>
      <div className="sb-row">
        <button type="button" className="btn" onClick={api.setAutoEnhance}>
          <Wand2 size={15} /> {tr('Automatikus')}
        </button>
        <button type="button" className="btn" onClick={api.resetEnhance}>
          <RotateCcw size={15} /> {tr('Alapértékek')}
        </button>
      </div>
    </div>
  );
}

function DisplaySection({ api }: { api: EditorApi }) {
  const d = api.display;
  const flip = (k: keyof typeof d) => api.setDisplay({ ...d, [k]: !d[k] });
  return (
    <div>
      <Switch label="Jelmagyarázat" on={d.oLegend} onClick={() => flip('oLegend')} />
      <Switch label="Északi irány" on={d.oNorth} onClick={() => flip('oNorth')} />
      <Switch label="Lépték" on={d.oScale} onClick={() => flip('oScale')} />
      <Switch label="Zónacímkék" on={d.oLabels} onClick={() => flip('oLabels')} />
      <Switch label="Zónák kitöltése" on={d.oFill} onClick={() => flip('oFill')} />
      <div className="sb-stack" style={{ marginTop: 8 }}>
        <Slider label="Címtábla" value={api.range.aT} min={0} max={100} onChange={(v) => api.setRange({ ...api.range, aT: v })} format={(v) => `${v}%`} />
        <Slider label="Jelmagyarázat" value={api.range.aL} min={0} max={100} onChange={(v) => api.setRange({ ...api.range, aL: v })} format={(v) => `${v}%`} />
      </div>
      <p className="sb-subhead">{tr('Jelmagyarázat színei')}</p>
      <ColorPair
        bgLabel="Tábla színe"
        fgLabel="Betűszín"
        bg={api.panels.legend.bg}
        fg={api.panels.legend.fg}
        bgDefault="#ffffff"
        fgDefault="#14181f"
        onChange={(patch) => api.updatePanelStyle('legend', patch)}
      />
      <div className="sb-grid2" style={{ marginTop: 8 }}>
        <ColorField label="Iránytű" value={api.panels.north.fg} fallback="#ffffff" onChange={(fg) => api.updatePanelStyle('north', { fg })} />
        <ColorField label="Lépték" value={api.panels.scale.fg} fallback="#ffffff" onChange={(fg) => api.updatePanelStyle('scale', { fg })} />
      </div>
      <button type="button" className="btn btn-block" style={{ marginTop: 12 }} onClick={api.resetPanels}>
        <RotateCcw size={15} /> {tr('Táblák alaphelyzetbe')}
      </button>
      <p className="sb-sub">{tr('A cím, a jelmagyarázat, az iránytű és a lépték a térképen húzással mozgatható.')}</p>
    </div>
  );
}

function ToolsSection({ api }: { api: EditorApi }) {
  return (
    <div className="sb-stack">
      <div className="tool-chips">
        <button type="button" className={`tool-chip ${api.tool === 'fpath' ? 'on' : ''}`} onClick={() => api.setTool('fpath')} title={tr('Szabadkézi útvonal (F)')}>
          <Spline size={15} /> {tr('Szabadkézi útvonal')}
        </button>
        <button type="button" className={`tool-chip ${api.tool === 'arrow' ? 'on' : ''}`} onClick={() => api.setTool('arrow')} title={tr('Bejárat nyíl (A)')}>
          <ArrowRight size={15} /> {tr('Bejárat nyíl')}
        </button>
      </div>
      <div className="hint">{tr(TOOL_HINTS[api.tool])}</div>
      {api.tool === 'tarrow' && (
        <ColorField label="Új szöveges nyíl színe" value={api.tCol} fallback="#ff8a00" onChange={(c) => api.setTCol(c || '#ff8a00')} />
      )}
      {api.tool === 'scale' && (
        <label className="sb-label">
          {tr('Valós távolság a két pont között (méter)')}
          <input
            type="number"
            min={1}
            className="sb-input"
            style={{ marginTop: 4 }}
            value={api.scaleMeters}
            onChange={(e) => api.setScaleMeters(Math.max(1, +e.target.value || 1))}
          />
        </label>
      )}
      <label className="check">
        <input type="checkbox" checked={api.autoSel} onChange={(e) => api.setAutoSel(e.target.checked)} />
        {tr('Rajzolás után vissza a kijelölésre')}
      </label>
      <div className="sb-row">
        <button type="button" className="btn" onClick={api.finish}>{tr('Kész (Enter)')}</button>
        <button type="button" className="btn" onClick={api.cancelDraw}>{tr('Mégse (Esc)')}</button>
      </div>
    </div>
  );
}

/* ---------- small shared controls ---------- */

export function Slider({
  label,
  value,
  min,
  max,
  onChange,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  format: (v: number) => string;
}) {
  return (
    <label className="slider">
      <span>{tr(label)}</span>
      <input type="range" className="range" min={min} max={max} value={value} onChange={(e) => onChange(+e.target.value)} aria-label={tr(label)} />
      <output>{format(value)}</output>
    </label>
  );
}

function Switch({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button type="button" className="switch-row" onClick={onClick} role="switch" aria-checked={on}>
      {tr(label)}
      <span className={`switch ${on ? 'on' : ''}`} />
    </button>
  );
}

/** Colour picker with an "alap" reset; an unset value means the default. */
function ColorField({
  label,
  value,
  fallback,
  onChange,
}: {
  label: string;
  value: string | undefined;
  fallback: string;
  onChange: (v: string | undefined) => void;
}) {
  return (
    <label className="color-field">
      <span className="color-field-head">
        {tr(label)}
        {value && (
          <button
            type="button"
            className="link-btn"
            onClick={(e) => {
              e.preventDefault();
              onChange(undefined);
            }}
            title={tr('Vissza az alapértelmezett színre')}
          >
            alap
          </button>
        )}
      </span>
      <input type="color" className="color-input" value={value || fallback} onChange={(e) => onChange(e.target.value)} aria-label={tr(label)} />
    </label>
  );
}

function ColorPair({
  bgLabel,
  fgLabel,
  bg,
  fg,
  bgDefault,
  fgDefault,
  onChange,
}: {
  bgLabel: string;
  fgLabel: string;
  bg: string | undefined;
  fg: string | undefined;
  bgDefault: string;
  fgDefault: string;
  onChange: (patch: { bg?: string; fg?: string }) => void;
}) {
  return (
    <div className="sb-grid2">
      <ColorField label={bgLabel} value={bg} fallback={bgDefault} onChange={(v) => onChange({ bg: v })} />
      <ColorField label={fgLabel} value={fg} fallback={fgDefault} onChange={(v) => onChange({ fg: v })} />
    </div>
  );
}
