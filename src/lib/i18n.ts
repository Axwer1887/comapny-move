import { useSyncExternalStore } from 'react';
import { EN } from '@/lib/i18n.en';

/**
 * Minimal two-language UI (Hungarian / English).
 * Hungarian text is the key: `t('Mentés')` returns it unchanged in HU mode and
 * the English entry from i18n.en.ts in EN mode (falling back to Hungarian if a
 * string has no translation). `{name}` placeholders are filled from `vars`.
 * Project content typed by the user (names, labels) is never translated.
 */
export type Lang = 'hu' | 'en';

const KEY = 'forgterkep.lang';
let lang: Lang = (() => {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'hu' || v === 'en') return v;
  } catch {
    /* ignore */
  }
  return typeof navigator !== 'undefined' && !/^hu\b/i.test(navigator.language || 'hu') ? 'en' : 'hu';
})();
const listeners = new Set<() => void>();
if (typeof document !== 'undefined') document.documentElement.lang = lang;

export function getLang(): Lang {
  return lang;
}

export function setLang(next: Lang) {
  if (next === lang) return;
  lang = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* ignore */
  }
  document.documentElement.lang = next;
  listeners.forEach((l) => l());
}

/** Re-render the calling component when the language changes. */
export function useLang(): Lang {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => lang,
  );
}

export function t(hu: string, vars?: Record<string, string | number>): string {
  let s = lang === 'en' ? EN[hu] ?? hu : hu;
  // "singular||plural" entries pick a form from the first numeric variable.
  if (s.includes('||')) {
    const n = vars ? Object.values(vars).find((v) => typeof v === 'number') : undefined;
    const [one, other] = s.split('||');
    s = n === 1 ? one : other;
  }
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

/** Locale for dates and numbers. */
export const locale = () => (lang === 'en' ? 'en-GB' : 'hu-HU');

/**
 * Default texts a new project starts with (title, categories, "Day 1"…).
 * While the user has not changed them they follow the UI language, in both
 * directions; anything the user typed is shown exactly as typed.
 */
const DEFAULT_KEYS = [
  'FORGATÁSI HELYSZÍN TÉRKÉP',
  'Város, utca, helyszín neve, irányítószám',
  'Új projekt',
  'BÁZIS',
  'Stáb bázis, pihenő, catering, smink, öltöző',
  'Forgatási helyszín',
  'TECHNIKAI + NAGY BUSZ PARKOLÓ',
  'Technikai járművek, buszok parkolója',
  'STÁB PARKOLÓ',
  'Stáb autók, személyautók',
  'Épületen belül (WC)',
  'ÚJ ZÓNA',
  'Leírás',
  'BEJÁRAT',
  'Szöveg',
];
const EN_TO_HU = new Map(DEFAULT_KEYS.map((k) => [EN[k], k]));

export function dt(value: string | undefined | null): string {
  if (!value) return value ?? '';
  const day = value.match(/^(?:(\d+)\. nap|Day (\d+))( \(másolat\)| \(copy\))?$/);
  if (day) {
    const n = day[1] || day[2];
    const copy = Boolean(day[3]);
    return lang === 'en' ? `Day ${n}${copy ? ' (copy)' : ''}` : `${n}. nap${copy ? ' (másolat)' : ''}`;
  }
  if (lang === 'en') return DEFAULT_KEYS.includes(value) ? EN[value] ?? value : value;
  return EN_TO_HU.get(value) ?? value;
}
