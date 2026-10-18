import { Copy, ImageOff, List, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import { dt, t as tr } from '@/lib/i18n';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { EditorApi } from '@/hooks/useMapEditor';
import type { MapItem } from '@/types';

interface Props {
  api: EditorApi;
}

function summary(items: MapItem[]): string {
  const places = items.filter((i) => i.kind === 'poly').length;
  const routes = items.filter((i) => i.kind === 'path').length;
  const parts = [tr('{v0} helyszín', { v0: places })];
  if (routes) parts.push(tr('{v0} útvonal', { v0: routes }));
  return parts.join(' · ');
}

export default function MapTabs({ api }: Props) {
  const [menu, setMenu] = useState<{ id: string; bottom: number; left: number } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menu) return undefined;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(null);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(null);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [menu]);

  const menuLap = menu ? api.laps.find((l) => l.id === menu.id) : null;

  return (
    <nav className="sheets" aria-label={tr('Munkalapok')}>
      <div className="sheet-label">
        <List size={18} /> {tr('Munkalapok')}
      </div>
      {api.laps.map((lap) => {
        const active = lap.id === api.activeLapId;
        // The active sheet's live content is in the editor, not yet in `laps`.
        const items = active ? api.items : lap.items;
        const img = active ? api.bgImage : lap.img;
        return (
          <div
            key={lap.id}
            className={`sheet ${active ? 'active' : ''}`}
            onClick={() => !active && api.switchLap(lap.id)}
            role="button"
            tabIndex={0}
            aria-current={active ? 'page' : undefined}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !active) api.switchLap(lap.id);
            }}
            title={active ? tr('Aktív munkalap') : tr('Váltás: {v0}', { v0: dt(lap.name) })}
          >
            {img ? (
              <div className="sheet-thumb" style={{ backgroundImage: `url(${img})` }} />
            ) : (
              <div className="sheet-thumb empty-thumb"><ImageOff size={16} /></div>
            )}
            <div className="sheet-copy">
              <strong>{dt(lap.name)}</strong>
              <span>{summary(items)}</span>
            </div>
            <button
              type="button"
              className="sheet-more"
              title={tr('Munkalap műveletei')}
              aria-haspopup="menu"
              onClick={(e) => {
                e.stopPropagation();
                const r = e.currentTarget.getBoundingClientRect();
                setMenu(menu?.id === lap.id ? null : { id: lap.id, bottom: window.innerHeight - r.top + 6, left: r.left });
              }}
            >
              <MoreHorizontal size={17} />
            </button>
          </div>
        );
      })}
      <button type="button" className="sheet-new" onClick={api.addLap} title={tr('Új munkalap (pl. következő forgatási nap)')}>
        <Plus size={20} />
        {tr('Új munkalap')}
      </button>

      {menu && menuLap &&
        createPortal(
          <div ref={menuRef} className="menu" role="menu" style={{ bottom: menu.bottom, left: menu.left }}>
            <button
              type="button"
              onClick={() => {
                const name = prompt(tr('Munkalap neve:'), dt(menuLap.name));
                if (name && name.trim()) api.renameLap(menuLap.id, name.trim());
                setMenu(null);
              }}
            >
              <Pencil size={15} /> {tr('Átnevezés')}
            </button>
            <button
              type="button"
              disabled={menuLap.id !== api.activeLapId}
              title={menuLap.id !== api.activeLapId ? tr('Előbb nyisd meg ezt a munkalapot') : undefined}
              onClick={() => {
                api.duplicateLap();
                setMenu(null);
              }}
            >
              <Copy size={15} /> {tr('Duplikálás')}
            </button>
            <div className="menu-sep" />
            <button
              type="button"
              className="danger"
              disabled={api.laps.length <= 1}
              onClick={() => {
                if (confirm(tr('Törlöd a(z) „{v0}” munkalapot és minden elemét?', { v0: dt(menuLap.name) }))) api.deleteLap(menuLap.id);
                setMenu(null);
              }}
            >
              <Trash2 size={15} /> {tr('Törlés')}
            </button>
            {menuLap.id !== api.activeLapId && <p className="menu-note">{tr('Duplikáláshoz előbb nyisd meg.')}</p>}
          </div>,
          document.body,
        )}
    </nav>
  );
}
