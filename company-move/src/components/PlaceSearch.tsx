import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { t as tr } from '@/lib/i18n';
import { createPortal } from 'react-dom';
import { LoaderCircle, Search, X } from 'lucide-react';
import type { EditorApi } from '@/hooks/useMapEditor';
import type { GoogleMapPanelHandle } from '@/components/GoogleMapPanel';

/** Place search wired to the existing Google geocoder in the map panel. */
export default function PlaceSearch({ api, mapPanelRef }: { api: EditorApi; mapPanelRef: MutableRefObject<GoogleMapPanelHandle | null> }) {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; err: boolean } | null>(null);
  const boxRef = useRef<HTMLFormElement | null>(null);
  const live = api.googleMapActive && !api.mapLocked;
  const reason = !api.googleMapActive
    ? tr('A Google térkép nem érhető el.')
    : api.mapLocked
      ? tr('A kereséshez oldd fel a térképet.')
      : '';

  useEffect(() => {
    if (!msg) return undefined;
    const t = setTimeout(() => setMsg(null), 5000);
    return () => clearTimeout(t);
  }, [msg]);

  const rect = boxRef.current?.getBoundingClientRect();

  return (
    <>
      <form
        ref={boxRef}
        className={`tb-search ${live ? '' : 'disabled'}`}
        role="search"
        title={reason || tr('Helyszín vagy cím keresése a Google térképen')}
        onSubmit={async (e) => {
          e.preventDefault();
          if (!live) {
            setMsg({ text: reason, err: true });
            return;
          }
          setBusy(true);
          const res = (await mapPanelRef.current?.search(q)) ?? { ok: false, message: tr('A térkép nem érhető el.') };
          setBusy(false);
          setMsg(res.ok ? { text: tr('Térkép áthelyezve: {v0}', { v0: q.trim() }), err: false } : { text: res.message || tr('Sikertelen keresés.'), err: true });
        }}
      >
        {busy ? <LoaderCircle size={16} className="spin" /> : <Search size={16} />}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={tr('Helyszín keresése…')}
          aria-label={tr('Helyszín keresése')}
          disabled={!live}
        />
        {q && live && (
          <button type="button" className="item-btn" onClick={() => setQ('')} aria-label={tr('Keresés törlése')}>
            <X size={14} />
          </button>
        )}
      </form>
      {msg && rect &&
        createPortal(
          <div
            className={`search-pop ${msg.err ? 'err' : ''}`}
            role="status"
            // Open upwards when the box sits low on the screen (on-map search).
            style={rect.bottom > window.innerHeight - 260 ? { bottom: window.innerHeight - rect.top + 6, left: rect.left } : { top: rect.bottom + 6, left: rect.left }}
          >
            {msg.text}
          </div>,
          document.body,
        )}
    </>
  );
}
