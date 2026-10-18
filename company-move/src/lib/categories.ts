import { Bath, Bus, Car, Clapperboard, House, MapPin, Truck, type LucideIcon } from 'lucide-react';
import { dt, t as tr } from '@/lib/i18n';
import type { MapItem, ZoneType } from '@/types';
import { PATH_COLOR } from '@/lib/defaults';
import { lum } from '@/lib/geometry';

/**
 * Icon for a zone category, picked from its (user-editable) name.
 * Purely presentational: nothing is stored, so renaming a category simply
 * picks a matching icon again.
 */
export function categoryIcon(name: string): LucideIcon {
  const n = name.toLowerCase();
  if (/b[áa]zis|base|catering|pihen|unit/.test(n)) return House;
  if (/\bset\b|forgat|helysz|location|filming/.test(n)) return Clapperboard;
  if (/busz|bus|kamion/.test(n)) return Bus;
  if (/techn/.test(n)) return Truck;
  if (/parkol|aut[óo]|st[áa]b|parking|car|crew/.test(n)) return Car;
  if (/wc|mosd|szolg|toilet|facilit/.test(n)) return Bath;
  return MapPin;
}

export function itemColor(item: MapItem, types: ZoneType[]): string {
  if (item.kind === 'poly') return types.find((t) => t.id === item.type)?.color || types[0]?.color || '#1677ff';
  if (item.kind === 'path') return PATH_COLOR;
  return item.col || '#ff8a00';
}

/** Display name: own name, else category name / route / arrow text. */
export function itemName(item: MapItem, types: ZoneType[]): string {
  const own = (item.name || '').trim();
  if (own) return own;
  if (item.kind === 'poly') return dt(types.find((t) => t.id === item.type)?.name) || tr('Névtelen zóna');
  if (item.kind === 'path') return tr('Útvonal');
  return item.txt === undefined ? tr('BEJÁRAT') : dt(item.txt) || tr('Nyíl');
}

export const readableOn = (bg: string) => (lum(bg) > 0.6 ? '#111111' : '#ffffff');
