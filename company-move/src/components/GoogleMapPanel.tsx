import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { t as tr } from '@/lib/i18n';
import { Map } from 'lucide-react';
import type { MapView } from '@/types';
import { DEFAULT_MAP_VIEW } from '@/lib/defaults';

interface Props {
  locked: boolean;
  view: MapView;
  onViewChange: (view: MapView) => void;
  onReadyChange: (ready: boolean) => void;
  onError?: (message: string) => void;
}

interface GoogleLatLng {
  lat: () => number;
  lng: () => number;
}

interface GoogleMapLike {
  setCenter: (center: { lat: number; lng: number }) => void;
  setZoom: (zoom: number) => void;
  setMapTypeId: (type: string) => void;
  setOptions: (options: Record<string, unknown>) => void;
  getCenter: () => GoogleLatLng | null | undefined;
  getZoom: () => number | undefined;
  addListener: (event: string, handler: () => void) => { remove: () => void };
}

interface GoogleMapsLike {
  Map: new (element: HTMLElement, options: Record<string, unknown>) => GoogleMapLike;
  event?: { addListener?: GoogleMapLike['addListener'] };
  Geocoder: new () => {
    geocode: (
      request: { address: string; region?: string; language?: string },
      callback: (results: Array<{ geometry: { location: GoogleLatLng } }> | null, status: string) => void,
    ) => void;
  };
}

interface GoogleWindow extends Window {
  google?: { maps: GoogleMapsLike };
}

export interface MapCapture {
  dataUrl: string;
  view: MapView;
  displayW: number;
  displayH: number;
  metersPerCssPx: number;
}

export interface SearchResult {
  ok: boolean;
  message?: string;
}

export interface GoogleMapPanelHandle {
  /** labels=false (default) gives a clean map: no place names, POI or transit icons. */
  captureBackground: (opts?: { labels?: boolean }) => Promise<MapCapture | null>;
  /** Geocode a place and move the live map there. */
  search: (query: string) => Promise<SearchResult>;
  zoomBy: (delta: number) => void;
  setSatellite: (on: boolean) => void;
}

const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
const scriptId = 'google-maps-script';

function readView(map: GoogleMapLike, satellite: boolean): MapView | null {
  const center = map.getCenter();
  const zoom = map.getZoom();
  if (!center || zoom == null) return null;
  return { lat: center.lat(), lng: center.lng(), zoom, satellite };
}

const GoogleMapPanel = forwardRef<GoogleMapPanelHandle, Props>(function GoogleMapPanel(
  { locked, view, onViewChange, onReadyChange, onError },
  ref,
) {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapInstance = useRef<GoogleMapLike | null>(null);
  const viewRef = useRef(view);
  const satelliteRef = useRef(view.satellite);
  const applyingRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [satellite, setSatellite] = useState(view.satellite);
  const [loadError, setLoadError] = useState('');

  viewRef.current = view;
  satelliteRef.current = satellite;

  useImperativeHandle(ref, () => ({
    captureBackground: async (opts?: { labels?: boolean }) => {
      if (!apiKey) return null;
      const map = mapInstance.current;
      const current = map ? readView(map, satelliteRef.current) : viewRef.current;
      const el = mapRef.current;
      if (!current || !el) return null;
      const displayW = el.clientWidth;
      const displayH = el.clientHeight;
      if (!displayW || !displayH) return null;

      // The Static Maps API caps each side at 640 (x2 with scale=2) and only
      // accepts integer zooms. Halving the requested size while dropping one
      // zoom level covers exactly the same ground, so we step down until the
      // visible area fits — the captured image then lines up with what the
      // user saw (and with anything already drawn on top of it).
      const zoom = Math.round(current.zoom);
      let n = 0;
      while (Math.max(displayW, displayH) / 2 ** n > 640 && n < 4) n++;
      const sizeW = Math.round(displayW / 2 ** n);
      const sizeH = Math.round(displayH / 2 ** n);
      const labels = Boolean(opts?.labels);
      const maptype = current.satellite ? (labels ? 'hybrid' : 'satellite') : 'roadmap';
      // Google's own markings (business pins, transit icons, and unless asked
      // for, all text labels) are switched off so the production markers
      // drawn on top stay readable.
      const styles = [
        'feature:poi|visibility:off',
        'feature:transit|visibility:off',
        ...(labels ? [] : ['element:labels|visibility:off']),
      ]
        .map((st) => `&style=${encodeURIComponent(st)}`)
        .join('');
      const url =
        'https://maps.googleapis.com/maps/api/staticmap?' +
        `center=${current.lat},${current.lng}` +
        `&zoom=${zoom - n}` +
        `&size=${sizeW}x${sizeH}&scale=2` +
        `&maptype=${maptype}&format=png&language=hu&region=HU` +
        styles +
        `&key=${encodeURIComponent(apiKey)}`;

      // Ground resolution of the live map in metres per CSS pixel.
      const metersPerCssPx = (156543.03392 * Math.cos((current.lat * Math.PI) / 180)) / 2 ** zoom;
      const result = (dataUrl: string | null) =>
        dataUrl ? { dataUrl, view: { ...current, zoom }, displayW, displayH, metersPerCssPx } : null;

      try {
        const res = await fetch(url);
        const ctype = res.headers.get('content-type') || '';
        if (res.ok && ctype.includes('image')) {
          const blob = await res.blob();
          const dataUrl = await new Promise<string | null>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(blob);
          });
          if (dataUrl) return result(dataUrl);
        }
      } catch {
        // fall through to the <img> path below
      }

      // Fallback: load through an <img> with CORS and copy it via a canvas.
      const dataUrl = await new Promise<string | null>((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          try {
            const c = document.createElement('canvas');
            c.width = img.naturalWidth;
            c.height = img.naturalHeight;
            c.getContext('2d')?.drawImage(img, 0, 0);
            resolve(c.toDataURL('image/png'));
          } catch {
            resolve(null);
          }
        };
        img.onerror = () => resolve(null);
        img.src = url;
      });
      return result(dataUrl);
    },
    search: (query: string) =>
      new Promise<SearchResult>((resolve) => {
        const google = (window as GoogleWindow).google;
        if (!query.trim()) return resolve({ ok: false, message: tr('Írj be egy helyszínt vagy címet.') });
        if (!google || !mapInstance.current) return resolve({ ok: false, message: tr('A Google térkép még nem töltődött be.') });
        new google.maps.Geocoder().geocode({ address: query.trim(), region: 'HU', language: 'hu' }, (results, status) => {
          const location = results?.[0]?.geometry.location;
          if (status === 'REQUEST_DENIED') {
            resolve({ ok: false, message: tr('A kereséshez engedélyezni kell a Geocoding API-t a Google Cloudban.') });
            return;
          }
          if (status !== 'OK' || !location) {
            resolve({ ok: false, message: tr('A helyszín nem található. Próbáld így: Inota, Magyarország.') });
            return;
          }
          mapInstance.current?.setCenter({ lat: location.lat(), lng: location.lng() });
          mapInstance.current?.setZoom(17);
          resolve({ ok: true });
        });
      }),
    zoomBy: (delta: number) => {
      const map = mapInstance.current;
      const z = map?.getZoom();
      if (map && z != null) map.setZoom(Math.max(1, Math.min(21, Math.round(z + delta))));
    },
    setSatellite: (on: boolean) => {
      const map = mapInstance.current;
      setSatellite(on);
      const current = map ? readView(map, on) : { ...viewRef.current, satellite: on };
      if (current) onViewChange(current);
    },
  }));

  useEffect(() => {
    if (!apiKey) {
      onReadyChange(false);
      return undefined;
    }

    let cancelled = false;
    let idleListener: { remove: () => void } | null = null;

    const init = () => {
      const google = (window as GoogleWindow).google;
      if (cancelled || !google || !mapRef.current || mapInstance.current) return;
      const start = viewRef.current || DEFAULT_MAP_VIEW;
      const map = new google.maps.Map(mapRef.current, {
        center: { lat: start.lat, lng: start.lng },
        zoom: start.zoom,
        mapTypeId: start.satellite ? 'hybrid' : 'roadmap',
        disableDefaultUI: true,
        // Google's own scale bar on the live map (our overlay scale is hidden
        // until the map is frozen).
        scaleControl: true,
        streetViewControl: false,
        fullscreenControl: false,
        mapTypeControl: false,
        rotateControl: false,
        panControl: false,
        heading: 0,
        tilt: 0,
      });
      mapInstance.current = map;
      const notify = () => {
        if (applyingRef.current) return;
        const next = readView(map, satelliteRef.current);
        if (next) onViewChange(next);
      };
      idleListener = map.addListener('idle', notify);
      setReady(true);
      setLoadError('');
      onReadyChange(true);
    };

    const fail = () => {
      if (cancelled) return;
      const msg = tr('A Google térkép nem töltődött be. Ellenőrizd a kulcsot és a HTTP-referer korlátozást.');
      setLoadError(msg);
      onReadyChange(false);
      onError?.(msg);
    };

    const existing = document.getElementById(scriptId) as HTMLScriptElement | null;
    if (existing) {
      if ((window as GoogleWindow).google?.maps?.Map) init();
      else {
        existing.addEventListener('load', init);
        existing.addEventListener('error', fail);
      }
    } else {
      const script = document.createElement('script');
      script.id = scriptId;
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}`;
      script.async = true;
      script.defer = true;
      script.addEventListener('load', init);
      script.addEventListener('error', fail);
      document.head.appendChild(script);
    }

    return () => {
      cancelled = true;
      idleListener?.remove();
      existing?.removeEventListener('load', init);
      existing?.removeEventListener('error', fail);
      onReadyChange(false);
    };
  }, [onError, onReadyChange, onViewChange]);

  useEffect(() => {
    mapInstance.current?.setOptions({
      draggable: !locked,
      scrollwheel: !locked,
      disableDoubleClickZoom: locked,
      gestureHandling: locked ? 'none' : 'greedy',
      zoomControl: false,
      keyboardShortcuts: !locked,
      clickableIcons: !locked,
    });
  }, [locked]);

  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;
    applyingRef.current = true;
    map.setCenter({ lat: view.lat, lng: view.lng });
    map.setZoom(view.zoom);
    setSatellite(view.satellite);
    map.setMapTypeId(view.satellite ? 'hybrid' : 'roadmap');
    window.setTimeout(() => {
      applyingRef.current = false;
    }, 80);
  }, [view.lat, view.lng, view.zoom, view.satellite]);

  useEffect(() => {
    if (!mapInstance.current) return;
    mapInstance.current.setMapTypeId(satellite ? 'hybrid' : 'roadmap');
  }, [satellite]);

  return (
    <div className={`google-map-panel ${locked ? 'is-locked' : ''}`}>
      <div ref={mapRef} className="google-map-surface" />
      {!apiKey ? (
        <div className="google-map-empty">
          <Map size={26} />
          <strong>{tr('Google térkép')}</strong>
          <span>{tr('A térképes kereséshez Google Maps hozzáférés szükséges.')}</span>
        </div>
      ) : loadError ? (
        <div className="google-map-empty">
          <Map size={26} />
          <strong>{tr('Térkép hiba')}</strong>
          <span>{loadError}</span>
        </div>
      ) : !ready ? (
        <div className="google-map-empty"><span>{tr('Google térkép betöltése…')}</span></div>
      ) : null}
    </div>
  );
});

export default GoogleMapPanel;
export const hasGoogleMapsKey = Boolean(apiKey);
