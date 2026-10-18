import { useEffect, useRef, useState } from 'react';
import { t as tr } from '@/lib/i18n';
import { ChevronLeft, ChevronRight, Clapperboard, FolderOpen, Image as ImageIcon, Layers, SlidersHorizontal } from 'lucide-react';
import { useMapEditor } from '@/hooks/useMapEditor';
import Sidebar from '@/components/Sidebar';
import MapCanvas from '@/components/MapCanvas';
import MapTabs from '@/components/MapTabs';
import PropertiesPanel from '@/components/PropertiesPanel';
import TopToolbar from '@/components/TopToolbar';
import Tooltips from '@/components/Tooltips';
import PdfPagePicker from '@/components/PdfPagePicker';
import type { GoogleMapPanelHandle } from '@/components/GoogleMapPanel';

const SB_KEY = 'forgterkep.ui.sidebarCollapsed';

function readCollapsed(): boolean {
  try {
    const v = localStorage.getItem(SB_KEY);
    if (v != null) return v === '1';
  } catch {
    /* storage unavailable */
  }
  return typeof window !== 'undefined' && window.innerWidth < 1200;
}

export default function App() {
  const api = useMapEditor();
  const mapPanelRef = useRef<GoogleMapPanelHandle | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readCollapsed);
  // Right panel: appears by itself, floating over the map, while something is
  // selected (so the map never jumps mid-edit), and can be docked next to
  // the map from the toolbar to stay open.
  const [pinned, setPinned] = useState(false);
  const hasSelection = Boolean(api.selItem && api.items.includes(api.selItem));
  const propsOpen = pinned || hasSelection;

  useEffect(() => {
    try {
      localStorage.setItem(SB_KEY, sidebarCollapsed ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [sidebarCollapsed]);

  const toggleProps = () => setPinned((p) => !p);
  const closeProps = () => {
    if (pinned) setPinned(false);
    else api.selectItem(-1); // floating panel: closing it clears the selection
  };

  return (
    <div className={`app ${sidebarCollapsed ? 'sb-collapsed' : ''}`}>
      <div className="sb">
        <div className="sb-brand">
          <div className="sb-brand-mark"><Clapperboard size={22} /></div>
          {!sidebarCollapsed && (
            <div className="sb-brand-text">
              <strong>COMPANY MOVE</strong>
              <span>LOCATION MAP MAKER</span>
            </div>
          )}
          <button
            type="button"
            className="sb-collapse"
            title={sidebarCollapsed ? tr('Oldalsáv megnyitása') : tr('Oldalsáv összecsukása')}
            aria-label={sidebarCollapsed ? tr('Oldalsáv megnyitása') : tr('Oldalsáv összecsukása')}
            onClick={() => setSidebarCollapsed((c) => !c)}
          >
            {sidebarCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
        </div>
        {sidebarCollapsed ? (
          <nav className="sb-rail" aria-label={tr('Oldalsáv')}>
            <button type="button" title={tr('Projekt')} onClick={() => setSidebarCollapsed(false)}><FolderOpen size={18} /></button>
            <button type="button" title={tr('Rétegek')} onClick={() => setSidebarCollapsed(false)}><Layers size={18} /></button>
            <button type="button" title={tr('Háttérkép')} onClick={() => setSidebarCollapsed(false)}><ImageIcon size={18} /></button>
            <button type="button" title={tr('Képjavítás')} onClick={() => setSidebarCollapsed(false)}><SlidersHorizontal size={18} /></button>
          </nav>
        ) : (
          <Sidebar api={api} />
        )}
      </div>

      <section className="main">
        <TopToolbar api={api} propsOpen={pinned} onToggleProperties={toggleProps} />
        <div className="body">
          <MapCanvas api={api} mapPanelRef={mapPanelRef} layoutKey={`${sidebarCollapsed}-${pinned}`} />
          {propsOpen && <PropertiesPanel api={api} floating={!pinned} onClose={closeProps} />}
        </div>
        <MapTabs api={api} />
      </section>
      <Tooltips />
      <PdfPagePicker api={api} />
    </div>
  );
}
