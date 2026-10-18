import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * App-wide tooltips. Every element keeps its plain `title` attribute (so
 * screen readers and the existing markup stay as they are); on hover or
 * keyboard focus the title is shown in a larger, readable bubble instead of
 * the browser's tiny native one, which is suppressed while ours is visible.
 */
export default function Tooltips() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number; below: boolean } | null>(null);
  const current = useRef<HTMLElement | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const restore = () => {
      const el = current.current;
      if (el && el.dataset.tip != null) {
        // React may have set a newer title meanwhile; don't overwrite it.
        if (!el.hasAttribute('title')) el.setAttribute('title', el.dataset.tip);
        delete el.dataset.tip;
      }
      current.current = null;
      window.clearTimeout(timer.current);
      setTip(null);
    };

    const show = (target: EventTarget | null, delay: number) => {
      const el = (target as HTMLElement | null)?.closest?.('[title], [data-tip]') as HTMLElement | null;
      if (!el || el === current.current) return;
      restore();
      const text = el.getAttribute('title') || '';
      if (!text.trim()) return;
      // Suppress the native tooltip while ours is shown.
      el.dataset.tip = text;
      el.removeAttribute('title');
      current.current = el;
      timer.current = window.setTimeout(() => {
        const r = el.getBoundingClientRect();
        const below = r.bottom + 48 < window.innerHeight;
        setTip({ text, x: r.left + r.width / 2, y: below ? r.bottom + 8 : r.top - 8, below });
      }, delay);
    };

    const onOver = (e: MouseEvent) => show(e.target, 350);
    const onOut = (e: MouseEvent) => {
      const el = current.current;
      if (el && !el.contains(e.relatedTarget as Node)) restore();
    };
    const onFocus = (e: FocusEvent) => {
      if ((e.target as HTMLElement).matches?.(':focus-visible')) show(e.target, 0);
    };
    const onHide = () => restore();

    document.addEventListener('mouseover', onOver);
    document.addEventListener('mouseout', onOut);
    document.addEventListener('focusin', onFocus);
    document.addEventListener('focusout', onHide);
    document.addEventListener('mousedown', onHide, true);
    document.addEventListener('keydown', onHide, true);
    window.addEventListener('scroll', onHide, true);
    return () => {
      restore();
      document.removeEventListener('mouseover', onOver);
      document.removeEventListener('mouseout', onOut);
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('focusout', onHide);
      document.removeEventListener('mousedown', onHide, true);
      document.removeEventListener('keydown', onHide, true);
      window.removeEventListener('scroll', onHide, true);
    };
  }, []);

  if (!tip) return null;
  // Keep the bubble on screen near the left/right edges.
  const x = Math.min(Math.max(tip.x, 140), window.innerWidth - 140);
  return createPortal(
    <div className={`tooltip ${tip.below ? 'below' : 'above'}`} role="tooltip" style={{ left: x, top: tip.y }}>
      {tip.text}
    </div>,
    document.body,
  );
}
