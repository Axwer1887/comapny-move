import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from 'react';
import { t as tr } from '@/lib/i18n';
import { Crosshair, ImagePlus, Layers, Lock, Map as MapIcon, Minus, Plus, Unlock } from 'lucide-react';
import type { EditorApi } from '@/hooks/useMapEditor';
import type { Tool } from '@/types';
import GoogleMapPanel, { type GoogleMapPanelHandle } from '@/components/GoogleMapPanel';
import PlaceSearch from '@/components/PlaceSearch';

interface Props {
  api: EditorApi;
  mapPanelRef: MutableRefObject<GoogleMapPanelHandle | null>;
  /** Changes whenever surrounding panels open/close, to re-fit the frame. */
  layoutKey: string;
}

const TOOL_CURSOR: Record<Tool, string> = {
  sel: 'default',
  free: 'crosshair',
  fpath: 'crosshair',
  poly: 'crosshair',
  rect: 'crosshair',
  path: 'crosshair',
  arrow: 'crosshair',
  tarrow: 'crosshair',
  scale: 'crosshair',
};

export default function MapCanvas({ api, mapPanelRef, layoutKey }: Props) {
  const { canvasRef, cw, ch, mapLocked } = api;
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [frame, setFrame] = useState<{ w: number; h: number } | null>(null);
  const [locking, setLocking] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const isUpload = api.bgSource === 'upload' && api.origImg;
  const pickSketch = () => fileRef.current?.click();
  // With a background image (captured map or uploaded photo) the canvas is
  // opaque; only without one does it act as a see-through overlay.
  const liveOverlay = api.googleMapActive && !api.origImg;
  const liveMap = liveOverlay && !mapLocked;
  // On a live (movable) Google map, a drawing tool cannot draw yet: the first
  // press on the map freezes the current view, then drawing works as usual.
  const drawWanted = liveMap && api.tool !== 'sel';
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (!notice) return undefined;
    const t = setTimeout(() => setNotice(''), 4500);
    return () => clearTimeout(t);
  }, [notice]);

  // Backing-store resolution: on-screen size × devicePixelRatio.
  const [dpr, setDpr] = useState(() => window.devicePixelRatio || 1);
  useEffect(() => {
    const mq = window.matchMedia(`(resolution: ${dpr}dppx)`);
    const onChange = () => setDpr(window.devicePixelRatio || 1);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, [dpr]);
  useEffect(() => {
    if (!frame) return;
    // Exactly what the screen can show (exports render separately at full
    // resolution), so large images do not make every redraw expensive.
    const MAX_PIXELS = 16e6;
    let pr = (frame.w * dpr) / cw;
    pr = Math.min(pr, 4, Math.sqrt(MAX_PIXELS / (cw * ch)));
    api.setCanvasResolution(Math.max(pr, 0.1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame, dpr, cw, ch]);

  const fillRef = useRef(false);
  fillRef.current = !api.origImg && api.items.length === 0 && !mapLocked;

  // Fit the map frame into the available area at the canvas aspect ratio,
  // so the map uses as much of the workspace as possible.
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return undefined;
    const fit = () => {
      const W = el.clientWidth;
      const H = el.clientHeight;
      if (!W || !H) return;
      if (fillRef.current) {
        // Empty project: let the canvas take the workspace's shape.
        api.setCanvasAspect(W / H);
      }
      const ar = cw / (ch || 1);
      const w = Math.min(W, H * ar);
      setFrame({ w: Math.floor(w), h: Math.floor(w / ar) });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cw, ch, layoutKey]);

  // Wheel / trackpad pinch zooms the map around the pointer. Registered as a
  // non-passive listener so Ctrl+wheel does not zoom the whole browser page.
  const wheelRef = useRef<(e: WheelEvent) => void>(() => {});
  wheelRef.current = (e: WheelEvent) => {
    e.preventDefault();
    if (drawWanted) {
      mapPanelRef.current?.zoomBy(e.deltaY < 0 ? 1 : -1);
      return;
    }
    api.wheelZoom(e.deltaY * (e.deltaMode === 1 ? 33 : 1), e.clientX, e.clientY);
  };
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return undefined;
    const h = (e: WheelEvent) => wheelRef.current(e);
    cv.addEventListener('wheel', h, { passive: false });
    return () => cv.removeEventListener('wheel', h);
  }, [canvasRef]);

  const toggleLock = async () => {
    if (mapLocked) {
      api.unlockMap();
      return;
    }
    if (!api.googleMapActive) {
      api.setMapLocked(true);
      return;
    }
    setLocking(true);
    const cap = await mapPanelRef.current?.captureBackground({ labels: api.captureLabels });
    const ok = cap ? await api.lockMapFromGoogle(cap) : false;
    setLocking(false);
    if (ok) setNotice(tr('A térkép rögzítve – most már rajzolhatsz rá. A feloldással újra mozgatható.'));
    if (!ok) {
      api.setMapLocked(true);
      api.setPMsg(
        tr('A térképképet nem sikerült lekérni (Maps Static API). Rajzolni lehet, de az exportban csak a rajz lesz benne.'),
      );
    }
  };

  const zoom = (dir: 1 | -1) => {
    if (liveMap) mapPanelRef.current?.zoomBy(dir);
    else api.changeZoom(dir * 0.1);
  };

  return (
    <main
      className="map-area"
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const f = e.dataTransfer.files[0];
        if (f) api.loadImageFile(f);
      }}
    >
      <div className="map-stage" ref={stageRef}>
        <div
          className={`map-frame ${dragOver ? 'dragover' : ''}`}
          style={frame ? { width: frame.w, height: frame.h } : { width: '100%', aspectRatio: `${cw} / ${ch}` }}
        >
          <GoogleMapPanel
            ref={mapPanelRef}
            locked={mapLocked}
            view={api.mapView}
            onViewChange={api.setMapView}
            onReadyChange={api.setGoogleMapActive}
            onError={api.setPMsg}
          />
          <canvas
            ref={canvasRef}
            className={`studio-canvas ${liveOverlay ? 'google-overlay-canvas' : ''}`}
            style={{ cursor: drawWanted ? 'pointer' : TOOL_CURSOR[api.tool], pointerEvents: liveMap && !drawWanted ? 'none' : 'auto' }}
            onPointerDown={(e) => {
              if (drawWanted) {
                e.preventDefault();
                if (!locking) toggleLock();
                return;
              }
              api.onPointerDown(e);
            }}
            onPointerMove={api.onPointerMove}
            onPointerUp={api.onPointerUp}
            onDoubleClick={api.onDblClick}
            onContextMenu={(e) => e.preventDefault()}
          />

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

          {liveMap && (
            <div className="map-search">
              <PlaceSearch api={api} mapPanelRef={mapPanelRef} />
              <button type="button" className="tb-btn map-upload" onClick={pickSketch} title={tr('Google térkép helyett saját térképvázlat (kép vagy PDF) feltöltése')}>
                <ImagePlus size={16} /> {tr('Saját vázlat')}
              </button>
            </div>
          )}

          {api.importing && (
            <div className="map-empty">
              <div className="map-empty-card" role="status">
                <strong>{tr('PDF feldolgozása…')}</strong>
                <span>{tr('Az oldal nagy felbontású képpé alakul.')}</span>
              </div>
            </div>
          )}

          {!api.importing && !api.googleMapActive && !api.origImg && (
            <div className="map-empty">
              <div className="map-empty-card">
                <ImagePlus size={28} color="#1677ff" />
                <strong>{tr('Saját térképvázlat')}</strong>
                <span>{tr('Tölts fel egy képet vagy PDF-et (rajz, alaprajz, helyszínrajz, fotó), és rajzolj rá. A fájlt ide is húzhatod.')}</span>
                <button type="button" className="btn btn-primary" onClick={pickSketch}>
                  <ImagePlus size={16} /> {tr('Kép vagy PDF feltöltése')}
                </button>
              </div>
            </div>
          )}

          {isUpload
            ? api.googleMapActive && (
                <button
                  type="button"
                  className="map-lock"
                  onClick={api.unlockMap}
                  title={tr('A feltöltött vázlat helyett a Google térkép használata (a rajzok megmaradnak)')}
                >
                  <MapIcon size={14} /> {tr('Google térkép használata')}
                </button>
              )
            : (api.googleMapActive || mapLocked) && (
                <button
                  type="button"
                  className={`map-lock ${mapLocked ? 'active' : ''}`}
                  onClick={toggleLock}
                  disabled={locking}
                  title={mapLocked ? tr('A rögzített háttér törlése, a Google térkép újra mozgatható') : tr('Az aktuális nézet rögzítése háttérként, utána lehet rá rajzolni')}
                >
                  {mapLocked ? <Unlock size={14} /> : <Lock size={14} />}
                  {locking ? tr('Rögzítés…') : mapLocked ? tr('Térkép feloldása') : tr('Térkép rögzítése')}
                </button>
              )}

          <div className="map-ctrls">
            <div className="map-ctrl-group">
              <button type="button" className="map-ctrl" onClick={api.fitView} title={tr('Nézet visszaállítása (100%)')}>
                <Crosshair size={18} />
              </button>
            </div>
            <div className="map-ctrl-group">
              <button type="button" className="map-ctrl" onClick={() => zoom(1)} title={liveMap ? tr('Térkép nagyítása') : tr('Nagyítás')}>
                <Plus size={18} />
              </button>
              <button type="button" className="map-ctrl" onClick={() => zoom(-1)} title={liveMap ? tr('Térkép kicsinyítése') : tr('Kicsinyítés')}>
                <Minus size={18} />
              </button>
            </div>
            <div className="map-ctrl-group">
              <button
                type="button"
                className={`map-ctrl ${api.mapView.satellite ? 'on' : ''}`}
                onClick={() => mapPanelRef.current?.setSatellite(!api.mapView.satellite)}
                disabled={!liveMap}
                title={liveMap ? (api.mapView.satellite ? tr('Váltás utcatérképre') : tr('Váltás műholdképre')) : tr('Térképtípus: csak feloldott Google térképnél')}
              >
                <Layers size={18} />
              </button>
            </div>
          </div>

          {(notice || liveMap) && (
            <div className="map-hint" role="status">
              {notice ||
                (drawWanted
                  ? tr('Kattints a térképre: rögzítjük a nézetet, és utána rajzolhatsz.')
                  : tr('Keresd meg a helyszínt, igazítsd be, majd rögzítsd a térképet.'))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
