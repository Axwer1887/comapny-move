import {
  Check,
  ChevronDown,
  Download,
  FileImage,
  FileJson,
  FileText,
  Hexagon,
  Keyboard,
  MousePointer2,
  PanelRight,
  Pencil,
  Printer,
  Redo2,
  Route,
  Ruler,
  Save,
  Square,
  Trash2,
  Type,
  Undo2,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { setLang, t as tr, useLang } from '@/lib/i18n';
import type { EditorApi } from '@/hooks/useMapEditor';
import type { Tool } from '@/types';

interface Props {
  api: EditorApi;
  propsOpen: boolean;
  onToggleProperties: () => void;
}

const tools: { id: Tool; label: string; tip: string; icon: typeof MousePointer2 }[] = [
  { id: 'sel', label: 'Kijelölés', tip: 'Kijelölés, mozgatás, forgatás (V)', icon: MousePointer2 },
  { id: 'rect', label: 'Terület', tip: 'Téglalap alakú zóna (R)', icon: Square },
  { id: 'free', label: 'Szabadkézi', tip: 'Szabadkézi zóna rajzolása (P)', icon: Pencil },
  { id: 'poly', label: 'Sokszög', tip: 'Zóna pontokkal, Enter vagy dupla kattintás zárja (B)', icon: Hexagon },
  { id: 'path', label: 'Útvonal', tip: 'Közlekedési útvonal pontokkal (L)', icon: Route },
  { id: 'tarrow', label: 'Szöveg', tip: 'Szöveges nyíl / felirat (T)', icon: Type },
  { id: 'scale', label: 'Mérés', tip: 'Lépték beállítása két ismert pont között (M)', icon: Ruler },
];

/** Close a floating menu on outside click or Escape. */
function useDismiss(open: boolean, close: () => void, refs: RefObject<HTMLElement>[]) {
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (refs.some((r) => r.current?.contains(t))) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}

export default function TopToolbar({ api, propsOpen, onToggleProperties }: Props) {
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const canDelete = Boolean(api.selItem && api.items.includes(api.selItem) && !api.selItem.locked);

  return (
    <header className="toolbar" role="toolbar" aria-label={tr('Eszköztár')}>
      <div className="tb-group" aria-label={tr('Szerkesztőeszközök')}>
        {tools.map(({ id, label, tip, icon: Icon }) => (
          <button
            key={id}
            type="button"
            className={`tool ${api.tool === id ? 'active' : ''}`}
            onClick={() => api.setTool(id)}
            title={tr(tip)}
            aria-pressed={api.tool === id}
          >
            <Icon size={19} strokeWidth={1.8} />
            <span>{tr(label)}</span>
          </button>
        ))}
      </div>

      <div className="tb-divider" />

      <div className="tb-group" aria-label={tr('Szerkesztési műveletek')}>
        <button type="button" className="tb-icon" onClick={api.undo} disabled={!api.canUndo} title={tr('Visszavonás (Ctrl+Z)')}>
          <Undo2 size={18} />
        </button>
        <button type="button" className="tb-icon" onClick={api.redo} disabled={!api.canRedo} title={tr('Újra (Ctrl+Y)')}>
          <Redo2 size={18} />
        </button>
        <button
          type="button"
          className="tb-icon"
          onClick={() => api.selItem && api.removeItem(api.items.indexOf(api.selItem))}
          disabled={!canDelete}
          title={api.selItem?.locked ? tr('A kijelölt elem zárolt') : tr('Kijelölt elem törlése (Del)')}
        >
          <Trash2 size={17} />
        </button>
      </div>

      <div className="tb-divider" />

      <div className="tb-group" aria-label={tr('Nézet')}>
        <ZoomMenu api={api} />
        <button
          type="button"
          className={`tb-icon ${propsOpen ? 'on' : ''}`}
          onClick={onToggleProperties}
          title={propsOpen ? tr('Tulajdonságpanel elrejtése') : tr('Tulajdonságpanel rögzítése a térkép mellett')}
          aria-pressed={propsOpen}
        >
          <PanelRight size={18} />
        </button>
        <button type="button" className="tb-icon tb-hide-narrow" onClick={() => setShortcutsOpen(true)} title={tr('Gyorsbillentyűk')}>
          <Keyboard size={18} />
        </button>
      </div>

      <div className="tb-spacer" />

      <div className="tb-group" aria-label={tr('Projektműveletek')} style={{ gap: 6, marginLeft: 6 }}>
        <button type="button" className="tb-icon tb-hide-narrow" onClick={api.saveCurrent} title={tr('Mentés (Ctrl+S)')}>
          <Save size={18} />
        </button>
        <LangSwitch />
        <ExportMenu api={api} />
      </div>

      {shortcutsOpen && <ShortcutsModal onClose={() => setShortcutsOpen(false)} />}
    </header>
  );
}

/** HU / EN switch for the whole interface (remembered in this browser). */
function LangSwitch() {
  const lang = useLang();
  return (
    <div className="lang-switch" role="radiogroup" aria-label={tr('Nyelv')}>
      <button type="button" role="radio" aria-checked={lang === 'hu'} className={lang === 'hu' ? 'on' : ''} onClick={() => setLang('hu')} title={tr('Váltás magyarra')}>
        HU
      </button>
      <button type="button" role="radio" aria-checked={lang === 'en'} className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')} title={tr('Váltás angolra')}>
        EN
      </button>
    </div>
  );
}

function ExportMenu({ api }: { api: EditorApi }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  useDismiss(open, () => setOpen(false), [btnRef, menuRef]);
  const run = (fn: () => void) => {
    fn();
    setOpen(false);
  };
  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="tb-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        title={tr('Exportálás')}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setPos({ top: r.bottom + 6, right: window.innerWidth - r.right });
          setOpen((o) => !o);
        }}
      >
        <Download size={16} /> <span className="tb-btn-label">{tr('Export')}</span> <ChevronDown size={14} />
      </button>
      {open &&
        createPortal(
          <div ref={menuRef} className="menu" role="menu" style={pos ? { top: pos.top, right: pos.right } : undefined}>
            <button type="button" onClick={() => run(api.exportPng)}><FileImage size={15} /> {tr('Térkép PNG képként')}</button>
            <button type="button" onClick={() => run(api.exportPdf)}><FileText size={15} /> {tr('Térkép PDF-ben (A4)')}</button>
            <button type="button" onClick={() => run(api.printMap)}><Printer size={15} /> {tr('Nyomtatás')}</button>
            <div className="menu-sep" />
            <button type="button" onClick={() => run(api.exportJson)}><FileJson size={15} /> {tr('Projektfájl (.json)')}</button>
          </div>,
          document.body,
        )}
    </>
  );
}

const ZOOM_PRESETS = [25, 50, 75, 100, 150, 200, 300, 400, 500];

/** Zoom level dropdown: presets plus a field for typing any value (20–500%). */
function ZoomMenu({ api }: { api: EditorApi }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [draft, setDraft] = useState('');
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const current = Math.round(api.zoom * 100);
  useDismiss(open, () => setOpen(false), [btnRef, menuRef]);

  const apply = (pct: number) => {
    if (!Number.isFinite(pct)) return;
    api.zoomTo(pct / 100);
    setOpen(false);
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`tb-select ${open ? 'active' : ''}`}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setPos({ top: r.bottom + 6, left: r.left });
          setDraft(String(current));
          setOpen((o) => !o);
        }}
        title={tr('Nagyítás mértéke')}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {current} % <ChevronDown size={14} />
      </button>
      {open &&
        createPortal(
          <div ref={menuRef} className="menu zoom-menu" role="menu" style={pos ? { top: pos.top, left: pos.left } : undefined}>
            <form
              className="zoom-menu-input"
              onSubmit={(e) => {
                e.preventDefault();
                apply(parseFloat(draft.replace(',', '.')));
              }}
            >
              <input
                autoFocus
                inputMode="numeric"
                value={draft}
                onChange={(e) => setDraft(e.target.value.replace(/[^0-9.,]/g, ''))}
                onFocus={(e) => e.currentTarget.select()}
                aria-label={tr('Nagyítás százalékban')}
              />
              <span>%</span>
            </form>
            {ZOOM_PRESETS.map((z) => (
              <button key={z} type="button" className={z === current ? 'is-current' : ''} onClick={() => apply(z)}>
                {z}%
                {z === current && <Check size={14} />}
              </button>
            ))}
            <div className="menu-sep" />
            <button
              type="button"
              onClick={() => {
                api.fitView();
                setOpen(false);
              }}
            >
              {tr('Teljes térkép (100%)')}
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}

function ShortcutsModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={tr('Gyorsbillentyűk')} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2><Keyboard size={18} /> {tr('Gyorsbillentyűk')}</h2>
          <button type="button" className="props-close" onClick={onClose} aria-label={tr('Bezárás')}><X size={17} /></button>
        </div>
        <div className="shortcut-grid">
          <div>
            <h3>{tr('Eszközök')}</h3>
            <ShortcutRow keys="V" label="Kijelölés / mozgatás" />
            <ShortcutRow keys="P" label="Szabadkézi zóna" />
            <ShortcutRow keys="B" label="Zóna (pontokkal)" />
            <ShortcutRow keys="R" label="Zóna (téglalap)" />
            <ShortcutRow keys="L" label="Közlekedési útvonal" />
            <ShortcutRow keys="F" label="Szabadkézi útvonal" />
            <ShortcutRow keys="A" label="Bejárat nyíl" />
            <ShortcutRow keys="T" label="Szöveges nyíl" />
            <ShortcutRow keys="M" label="Lépték beállítása" />
          </div>
          <div>
            <h3>{tr('Szerkesztés')}</h3>
            <ShortcutRow keys="Enter" label="Rajz befejezése" />
            <ShortcutRow keys="Esc" label="Mégse / kijelölés törlése" />
            <ShortcutRow keys="Del" label="Kijelölt elem törlése" />
            <ShortcutRow keys="Ctrl Z" label="Visszavonás" />
            <ShortcutRow keys="Ctrl Y" label="Újra" />
            <ShortcutRow keys="R" label="Kijelölt elem forgatása 90°" />
            <ShortcutRow keys="H" label="Kijelölt elem elrejtése/mutatása" />
          </div>
          <div>
            <h3>{tr('Nézet')}</h3>
            <ShortcutRow keys="Ctrl +" label="Nagyítás" />
            <ShortcutRow keys="Ctrl −" label="Kicsinyítés" />
            <ShortcutRow keys="Ctrl 0" label="Teljes térkép (100%)" />
            <ShortcutRow keys="Görgő" label="Nagyítás a kurzornál" />
            <ShortcutRow keys="Húzás" label="Mozgatás (Kijelölés eszközzel, üres helyen)" />
            <ShortcutRow keys="← ↑ → ↓" label="Mozgatás (Shift: nagyobb lépés)" />
            <ShortcutRow keys="Space" label="Mozgatás bármely eszközzel (nyomva tartva)" />
          </div>
          <div>
            <h3>{tr('Fájl')}</h3>
            <ShortcutRow keys="Ctrl S" label="Mentés" />
            <ShortcutRow keys="Ctrl E" label="Exportálás PNG-be" />
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ShortcutRow({ keys, label }: { keys: string; label: string }) {
  return (
    <div className="shortcut-row">
      <span className="shortcut-keys">{tr(keys).split(' ').map((k, i) => (<kbd key={i}>{k}</kbd>))}</span>
      <span className="shortcut-label">{tr(label)}</span>
    </div>
  );
}
