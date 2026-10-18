import { useState } from 'react';
import { dt, locale, t as tr } from '@/lib/i18n';
import { ArrowRight, ChevronDown, ChevronUp, Copy, Eye, EyeOff, Lock, RotateCw, Route, Trash2, X } from 'lucide-react';
import type { EditorApi } from '@/hooks/useMapEditor';
import type { MapItem } from '@/types';
import { PALETTE, PATH_COLOR } from '@/lib/defaults';
import { categoryIcon, itemColor, itemName, readableOn } from '@/lib/categories';

interface Props {
  api: EditorApi;
  /** Floating over the map (auto-opened by a selection) instead of docked. */
  floating: boolean;
  onClose: () => void;
}

export default function PropertiesPanel({ api, floating, onClose }: Props) {
  const item = api.selItem && api.items.includes(api.selItem) ? api.selItem : null;
  return (
    <aside className={`props ${floating ? 'floating' : ''}`} aria-label={tr('Tulajdonságok')}>
      <div className="props-head">
        <h2>{item ? tr('Kijelölt elem') : tr('Térkép elemei')}</h2>
        <button type="button" className="props-close" onClick={onClose} title={floating ? tr('Bezárás (a kijelölés megszűnik)') : tr('Panel bezárása')} aria-label={tr('Panel bezárása')}>
          <X size={18} />
        </button>
      </div>
      <div className="props-scroll">{item ? <ItemEditor api={api} item={item} /> : <Overview api={api} />}</div>
    </aside>
  );
}

const KIND_LABEL: Record<MapItem['kind'], string> = { poly: 'Terület', path: 'Útvonal', arrow: 'Nyíl / felirat' };

function pathLength(item: MapItem, mpp: number | null): string | null {
  if (!mpp || item.pts.length < 2) return null;
  let px = 0;
  for (let i = 1; i < item.pts.length; i++) {
    px += Math.hypot(item.pts[i][0] - item.pts[i - 1][0], item.pts[i][1] - item.pts[i - 1][1]);
  }
  const m = px * mpp;
  const dist = m >= 1000 ? `${(m / 1000).toLocaleString(locale(), { maximumFractionDigits: 1 })} km` : `${Math.round(m)} m`;
  const min = Math.max(1, Math.round((m / 5000) * 60)); // 5 km/h walking
  return tr('{dist} · kb. {min} perc gyalog', { dist, min });
}

function ItemEditor({ api, item }: { api: EditorApi; item: MapItem }) {
  const [tab, setTab] = useState<'base' | 'note'>('base');
  const idx = api.items.indexOf(item);
  const type = item.kind === 'poly' ? api.types.find((t) => t.id === item.type) : undefined;
  const color = itemColor(item, api.types);
  const Icon = item.kind === 'poly' ? categoryIcon(type?.name || '') : item.kind === 'path' ? Route : ArrowRight;
  const subtitle = item.kind === 'poly' ? dt(type?.desc) || dt(type?.name) || tr('Terület') : tr(KIND_LABEL[item.kind]);
  const lapName = dt(api.laps.find((l) => l.id === api.activeLapId)?.name || '');
  const length = item.kind === 'path' ? pathLength(item, api.mpp) : null;
  const set = (patch: Partial<MapItem>) => api.updateSelItem(patch);

  return (
    <>
      <div className="props-hero">
        <span className="props-badge" style={{ background: color, color: readableOn(color) }}>
          <Icon size={22} />
        </span>
        <div style={{ minWidth: 0 }}>
          <strong>{itemName(item, api.types)}</strong>
          <span>{subtitle}</span>
        </div>
      </div>

      <div className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'base'} className={`tab ${tab === 'base' ? 'active' : ''}`} onClick={() => setTab('base')}>
          {tr('Alapadatok')}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'note'} className={`tab ${tab === 'note' ? 'active' : ''}`} onClick={() => setTab('note')}>
          {tr('Megjegyzés')}
        </button>
      </div>

      {tab === 'base' ? (
        <>
          {item.kind === 'arrow' ? (
            <Field label="Szöveg">
              <input className="input" value={item.txt === undefined ? tr('BEJÁRAT') : dt(item.txt)} onChange={(e) => set({ txt: e.target.value })} placeholder={tr('pl. BEJÁRAT')} />
            </Field>
          ) : (
            <Field label="Név">
              <input
                className="input"
                value={item.name || ''}
                onChange={(e) => set({ name: e.target.value || undefined })}
                placeholder={item.kind === 'poly' ? dt(type?.name) || 'pl. SET 1' : tr('pl. Útvonal 1')}
              />
            </Field>
          )}

          {item.kind === 'poly' && (
            <>
              <Field label="Kategória">
                <select className="input" value={item.type} onChange={(e) => set({ type: +e.target.value })}>
                  {api.types.map((t) => (
                    <option key={t.id} value={t.id}>{dt(t.name)}</option>
                  ))}
                </select>
              </Field>
              <Field label="Szín" group>
                <div className="swatches">
                  {api.types.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      className={`swatch ${t.id === item.type ? 'on' : ''}`}
                      style={{ background: t.color }}
                      onClick={() => set({ type: t.id })}
                      title={dt(t.name)}
                      aria-label={tr('Kategória: {v0}', { v0: dt(t.name) })}
                    />
                  ))}
                </div>
              </Field>
              <p className="props-note" style={{ marginLeft: 114 }}>{tr('A szín a kategóriához tartozik, így a jelmagyarázat egységes marad.')}</p>
              <Field label="Cím">
                <input className="input" value={item.addr || ''} onChange={(e) => set({ addr: e.target.value || undefined })} placeholder={tr('pl. 1033 Budapest, Sportpálya')} />
              </Field>
            </>
          )}

          {item.kind === 'arrow' && (
            <>
              <Field label="Szín" group>
                <div className="swatches">
                  {[...PALETTE, '#e5484d', '#299764'].map((c) => (
                    <button key={c} type="button" className={`swatch ${(item.col || '#ff8a00') === c ? 'on' : ''}`} style={{ background: c }} onClick={() => set({ col: c })} aria-label={tr('Szín {v0}', { v0: c })} />
                  ))}
                  <input type="color" className="color-input square" value={item.col || '#ff8a00'} onChange={(e) => set({ col: e.target.value })} title={tr('Egyéni szín')} aria-label={tr('Egyéni szín')} />
                </div>
              </Field>
              <Field label="Betűszín">
                <input type="color" className="color-input" style={{ marginTop: 0 }} value={item.fg || readableOn(item.col || '#ff8a00')} onChange={(e) => set({ fg: e.target.value })} aria-label={tr('Betűszín')} />
              </Field>
            </>
          )}

          {item.kind !== 'arrow' && (
            <Field label="Leírás" top>
              <textarea className="input" rows={3} value={item.desc || ''} onChange={(e) => set({ desc: e.target.value || undefined })} placeholder={item.kind === 'path' ? tr('pl. Gyalogos útvonal a bázistól a SET-ig') : tr('pl. Kültéri jelenetek, drónfelvétel lehetséges')} />
            </Field>
          )}

          {length && (
            <Field label="Hossz" group>
              <span style={{ fontSize: 13 }}>{length}</span>
            </Field>
          )}
          {item.kind === 'path' && !length && <p className="props-note">{tr('A hossz kiszámításához rögzíts egy Google térképet, vagy állítsd be a léptéket (Mérés).')}</p>}

          {item.kind === 'poly' && (
            <>
              <Field label="Kapcsolattartó">
                <input className="input" value={item.contact || ''} onChange={(e) => set({ contact: e.target.value || undefined })} placeholder={tr('Név')} />
              </Field>
              <Field label="Telefonszám">
                <input className="input" type="tel" value={item.phone || ''} onChange={(e) => set({ phone: e.target.value || undefined })} placeholder="+36 30 123 4567" />
              </Field>
            </>
          )}

          <Field label="Munkalap" group>
            <span style={{ fontSize: 13 }}>{lapName}</span>
          </Field>

          <div className="props-sep" />
          <button type="button" className="switch-row" role="switch" aria-checked={!item.hidden} onClick={() => api.toggleItemHidden(idx)}>
            {tr('Látható a térképen')}
            <span className={`switch ${!item.hidden ? 'on' : ''}`} />
          </button>
          <button type="button" className="switch-row" role="switch" aria-checked={Boolean(item.locked)} onClick={() => set({ locked: item.locked ? undefined : true })}>
            {tr('Zárolt elem')}
            <span className={`switch ${item.locked ? 'on' : ''}`} />
          </button>
          {item.locked && <p className="props-note">{tr('Zárolt elemet a térképen nem lehet mozgatni, forgatni vagy törölni.')}</p>}
        </>
      ) : (
        <Field label="Megjegyzés" top>
          <textarea className="input" rows={8} value={item.note || ''} onChange={(e) => set({ note: e.target.value || undefined })} placeholder={tr('Belső megjegyzés a stábnak (nem jelenik meg a térképen)')} />
        </Field>
      )}

      <div className="props-actions">
        <button type="button" className="btn btn-danger" onClick={() => api.removeItem(idx)} disabled={Boolean(item.locked)} title={item.locked ? tr('Zárolt elem') : tr('Törlés (Ctrl+Z-vel visszavonható)')}>
          <Trash2 size={15} /> {tr('Törlés')}
        </button>
        <button type="button" className="btn" onClick={api.duplicateItem}>
          <Copy size={15} /> {tr('Duplikálás')}
        </button>
      </div>
      {item.kind === 'poly' && !item.locked && (
        <button type="button" className="btn btn-block" style={{ marginTop: 10 }} onClick={api.rotateSel90}>
          <RotateCw size={15} /> {tr('Forgatás 90°')}
        </button>
      )}
    </>
  );
}

function Overview({ api }: { api: EditorApi }) {
  const d = api.display;
  const flip = (k: keyof typeof d) => api.setDisplay({ ...d, [k]: !d[k] });
  return (
    <>
      <h3 className="props-h3" style={{ marginTop: 0 }}>{tr('Elemek')} · {api.items.length}</h3>
      {api.items.length === 0 ? (
        <p className="empty">{tr('Még nincs elem. Válassz egy eszközt fent, és rajzolj a térképre.')}</p>
      ) : (
        <ul className="item-list">
          {[...api.items].reverse().map((item, rev) => {
            const idx = api.items.length - 1 - rev;
            return (
              <li
                key={idx}
                className={`item-row ${item.hidden ? 'off' : ''}`}
                onClick={() => api.selectItem(idx)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && api.selectItem(idx)}
              >
                <span className="layer-dot" style={{ background: item.kind === 'path' ? PATH_COLOR : itemColor(item, api.types) }} />
                <span className="item-name">{itemName(item, api.types)}</span>
                {item.locked && <Lock size={13} color="#64748b" aria-label={tr('Zárolt')} />}
                <button type="button" className="item-btn" disabled={idx >= api.items.length - 1} onClick={(e) => { e.stopPropagation(); api.moveItem(idx, 1); }} title={tr('Előrébb hoz')}>
                  <ChevronUp size={14} />
                </button>
                <button type="button" className="item-btn" disabled={idx <= 0} onClick={(e) => { e.stopPropagation(); api.moveItem(idx, -1); }} title={tr('Hátrébb küld')}>
                  <ChevronDown size={14} />
                </button>
                <button type="button" className="item-btn" onClick={(e) => { e.stopPropagation(); api.toggleItemHidden(idx); }} title={item.hidden ? tr('Megjelenítés') : tr('Elrejtés')}>
                  {item.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
                <button type="button" className="item-btn danger" disabled={Boolean(item.locked)} onClick={(e) => { e.stopPropagation(); api.removeItem(idx); }} title={tr('Törlés')}>
                  <Trash2 size={13} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <h3 className="props-h3">{tr('Megjelenítés')}</h3>
      <Toggle label="Jelmagyarázat" on={d.oLegend} onClick={() => flip('oLegend')} />
      <Toggle label="Északi irány" on={d.oNorth} onClick={() => flip('oNorth')} />
      <Toggle label="Lépték" on={d.oScale} onClick={() => flip('oScale')} />
      <Toggle label="Zónacímkék" on={d.oLabels} onClick={() => flip('oLabels')} />
    </>
  );
}

function Toggle({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button type="button" className="switch-row" role="switch" aria-checked={on} onClick={onClick}>
      {tr(label)}
      <span className={`switch ${on ? 'on' : ''}`} />
    </button>
  );
}

/**
 * Label + control row. Rows holding buttons (swatches) or plain text use a
 * <div>: a <label> would forward clicks on its text to the first button.
 */
function Field({ label, top, group, children }: { label: string; top?: boolean; group?: boolean; children: React.ReactNode }) {
  const Tag = group ? 'div' : 'label';
  return (
    <Tag className={`field ${top ? 'top' : ''}`} role={group ? 'group' : undefined} aria-label={group ? tr(label) : undefined}>
      <span>{tr(label)}</span>
      {children}
    </Tag>
  );
}
