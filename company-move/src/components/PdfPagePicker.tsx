import { useEffect, useState } from 'react';
import { t as tr } from '@/lib/i18n';
import { createPortal } from 'react-dom';
import { FileText, X } from 'lucide-react';
import type { EditorApi } from '@/hooks/useMapEditor';

type Pending = { thumbs: string[]; total: number; resolve: (page: number | null) => void };

/** Modal for choosing which page of a multi-page PDF becomes the sketch. */
export default function PdfPagePicker({ api }: { api: EditorApi }) {
  const [pending, setPending] = useState<Pending | null>(null);

  useEffect(() => {
    api.setPdfPagePicker((thumbs, total) => new Promise<number | null>((resolve) => setPending({ thumbs, total, resolve })));
    return () => api.setPdfPagePicker(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!pending) return undefined;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && choose(null);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  const choose = (page: number | null) => {
    pending?.resolve(page);
    setPending(null);
  };

  if (!pending) return null;
  return createPortal(
    <div className="modal-overlay" onClick={() => choose(null)}>
      <div className="modal pdf-modal" role="dialog" aria-modal="true" aria-label={tr('PDF oldal kiválasztása')} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2><FileText size={18} /> {tr('Melyik oldal legyen a térképvázlat?')}</h2>
          <button type="button" className="props-close" onClick={() => choose(null)} aria-label={tr('Mégse')}><X size={17} /></button>
        </div>
        <p className="props-note">
          {tr('A PDF {n} oldalas.', { n: pending.total })}
          {pending.total > pending.thumbs.length ? ' ' + tr('Az első {n} oldal látható.', { n: pending.thumbs.length }) : ''}{' '}
          {tr('Kattints a használni kívánt oldalra.')}
        </p>
        <div className="pdf-grid">
          {pending.thumbs.map((src, i) => (
            <button key={i} type="button" className="pdf-page" onClick={() => choose(i + 1)} title={tr('{v0}. oldal használata', { v0: i + 1 })}>
              <img src={src} alt={tr('{v0}. oldal', { v0: i + 1 })} />
              <span>{tr('{v0}. oldal', { v0: i + 1 })}</span>
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
