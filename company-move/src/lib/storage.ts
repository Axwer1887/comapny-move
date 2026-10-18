import { createClient } from '@supabase/supabase-js';
import type { ProjectState } from '@/types';

const url = import.meta.env.VITE_SUPABASE_URL as string;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const supabase = createClient(url, key);

/**
 * This editor has no sign-in screen, so the browser talks to Supabase as the
 * anon role. RLS is open to anon/authenticated (single-tenant pattern). To keep
 * each browser's saved projects isolated from other visitors without a login,
 * we generate a random UUID per browser and store it in localStorage, then use
 * it as the `owner_id` value for every read and write. The column is plain text
 * (not a FK to auth.users) so an arbitrary client-chosen value is accepted.
 */
const OWNER_KEY = 'forgterkep.owner.v1';

function getOwnerId(): string {
  try {
    let id = localStorage.getItem(OWNER_KEY);
    if (!id) {
      if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        id = crypto.randomUUID();
      } else {
        id = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
          const r = (Math.random() * 16) | 0;
          const v = c === 'x' ? r : (r & 0x3) | 0x8;
          return v.toString(16);
        });
      }
      localStorage.setItem(OWNER_KEY, id);
    }
    return id;
  } catch {
    return '00000000-0000-4000-8000-000000000000';
  }
}

/**
 * Canonical form for a project name: trimmed, inner whitespace collapsed and
 * unicode-normalised, so a name cannot differ from an existing one by invisible
 * characters alone. The database enforces the same rule via a generated column.
 */
export function canonicalName(name: string): string {
  return name.normalize('NFC').replace(/\s+/g, ' ').trim();
}

export async function listProjects(): Promise<ProjectState[]> {
  const owner = getOwnerId();
  const { data, error } = await supabase
    .from('projects')
    .select('data')
    .eq('owner_id', owner)
    .eq('auto', false)
    .order('t', { ascending: false });
  if (error || !data) return [];
  return data.map((r) => r.data as ProjectState);
}

export async function saveProject(p: ProjectState): Promise<boolean> {
  const owner = getOwnerId();
  const name = canonicalName(p.name);
  if (!name) return false;
  const { error } = await supabase
    .from('projects')
    .upsert(
      { name, data: { ...p, name }, auto: false, t: p.t, owner_id: owner },
      { onConflict: 'owner_id,name_key' }
    );
  return !error;
}

export async function deleteProject(name: string): Promise<void> {
  const owner = getOwnerId();
  await supabase
    .from('projects')
    .delete()
    .eq('owner_id', owner)
    .eq('name_key', canonicalName(name).toLowerCase());
}

export async function storageAvailable(): Promise<boolean> {
  try {
    const owner = getOwnerId();
    const { error } = await supabase
      .from('projects')
      .select('name')
      .eq('owner_id', owner)
      .limit(1);
    return !error;
  } catch {
    return false;
  }
}

/**
 * Autosave is per-browser scratch state, so it lives in this browser only.
 */
const AUTO_KEY = 'forgterkep.autosave.v1';

/*
 * Background images (several MB as data URLs) are kept apart from the main
 * autosave entry, in IndexedDB (large quota) with a localStorage fallback,
 * and only rewritten when they actually change. The main entry stays a few
 * KB, so saving after each edit no longer stalls the editor, and big sketches
 * survive a reload. Older autosaves with inline images still load unchanged.
 */
const IMG_PREFIX = 'forgterkep.autosave.img.';
const IMG_REF = '@img:';
const written = new Map<string, string>(); // key -> data last written

let dbPromise: Promise<IDBDatabase | null> | null = null;
function db(): Promise<IDBDatabase | null> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open('forgterkep', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('images');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }
  return dbPromise;
}
async function idb<T>(mode: IDBTransactionMode, fn: (st: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  const d = await db();
  if (!d) throw new Error('no idb');
  return new Promise((resolve, reject) => {
    const tx = d.transaction('images', mode);
    const req = fn(tx.objectStore('images'));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function putImg(key: string, data: string): Promise<boolean> {
  try {
    await idb('readwrite', (st) => st.put(data, key));
    try { localStorage.removeItem(key); } catch { /* ignore */ }
    return true;
  } catch {
    try {
      localStorage.setItem(key, data);
      return true;
    } catch {
      return false; // storage full
    }
  }
}
async function getImg(key: string): Promise<string | null> {
  try {
    const v = await idb<string>('readonly', (st) => st.get(key));
    if (typeof v === 'string') return v;
  } catch {
    /* fall back below */
  }
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
async function pruneImgs(used: Set<string>) {
  try {
    const keys = ((await idb<IDBValidKey[]>('readonly', (st) => st.getAllKeys())) || []) as string[];
    for (const k of keys) if (!used.has(k)) await idb('readwrite', (st) => st.delete(k));
  } catch {
    /* ignore */
  }
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(IMG_PREFIX) && !used.has(k)) localStorage.removeItem(k);
    }
  } catch {
    /* ignore */
  }
  for (const k of [...written.keys()]) if (!used.has(k)) written.delete(k);
}

export async function getAuto(): Promise<ProjectState | null> {
  try {
    const raw = localStorage.getItem(AUTO_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as ProjectState;
    const inflate = async (v: string | null | undefined) => {
      if (typeof v !== 'string' || !v.startsWith(IMG_REF)) return v ?? null;
      const key = IMG_PREFIX + v.slice(IMG_REF.length);
      const data = await getImg(key);
      if (data) written.set(key, data);
      return data;
    };
    p.img = await inflate(p.img);
    if (Array.isArray(p.laps)) p.laps = await Promise.all(p.laps.map(async (l) => ({ ...l, img: await inflate(l.img) })));
    return p;
  } catch {
    return null;
  }
}

let saving: Promise<void> = Promise.resolve();
export function saveAuto(p: ProjectState): Promise<void> {
  // Serialise saves so an older one can never finish after a newer one.
  saving = saving.then(() => doSaveAuto(p)).catch(() => undefined);
  return saving;
}

async function doSaveAuto(p: ProjectState): Promise<void> {
  try {
    const used = new Set<string>();
    const byData = new Map<string, string>(); // same image in several slots -> one copy
    const stash = async (slot: string, data: string | null | undefined): Promise<string | null> => {
      if (!data) return null;
      const known = byData.get(data);
      if (known) return IMG_REF + known;
      const key = IMG_PREFIX + slot;
      if (written.get(key) !== data) {
        if (!(await putImg(key, data))) return null;
        written.set(key, data);
      }
      used.add(key);
      byData.set(data, slot);
      return IMG_REF + slot;
    };
    const img = await stash('main', p.img);
    const laps = p.laps ? await Promise.all(p.laps.map(async (l) => ({ ...l, img: await stash(`lap.${l.id}`, l.img) }))) : undefined;
    localStorage.setItem(AUTO_KEY, JSON.stringify({ ...p, img, laps }));
    await pruneImgs(used);
  } catch {
    /* quota exceeded or storage unavailable: autosave is best-effort */
  }
}
