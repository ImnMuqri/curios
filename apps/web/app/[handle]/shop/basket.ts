import { formatRinggit } from '@curios/core/store';
import type { ShopItem } from '@curios/db-read';
import type { ShopCopy } from './copy.js';

/** What pricing a basket needs of an item: the shelf's name, price and options. */
export type PricedItem = Pick<ShopItem, 'id' | 'name' | 'priceCents' | 'options'>;

/** What the browser keeps: ids and counts, never prices -- a price is always read from the shelf as it is now. */
export interface BasketLine {
  itemId: string;
  optionId: string | null;
  quantity: number;
}

/** Where a shop's basket is kept, so the shelf and checkout read the same one. */
export const defaultStorageKey = (handle: string) => `curios-basket:${handle}`;

/** Storage is the visitor's to edit, so each saved line is checked before anything prices or counts it. */
function isBasketLine(value: unknown): value is BasketLine {
  if (typeof value !== 'object' || value === null) return false;
  const line = value as Record<string, unknown>;
  return (
    typeof line.itemId === 'string' &&
    (line.optionId === null || typeof line.optionId === 'string') &&
    typeof line.quantity === 'number' &&
    Number.isInteger(line.quantity) &&
    line.quantity > 0
  );
}

/** sessionStorage can be missing or throw (private windows, blocked storage); the basket then lives in memory only. */
export function readBasket(key: string): BasketLine[] {
  try {
    const raw = window.sessionStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(isBasketLine) : [];
  } catch {
    return [];
  }
}

/** Fired on `window` whenever a basket is written, so a bar elsewhere on the same page follows it (sessionStorage's own event only reaches other tabs). */
export const BASKET_EVENT = 'curios-basket';

export function writeBasket(key: string, lines: BasketLine[]) {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(lines));
  } catch {
    // Memory only, as above.
  }
  window.dispatchEvent(new Event(BASKET_EVENT));
}

export interface PricedLine extends BasketLine {
  name: string;
  optionLabel: string | null;
  unitCents: number;
  lineCents: number;
}

/**
 * The basket against the current shelf. A line whose item was taken down, or
 * whose option no longer exists, is dropped rather than priced at a number the
 * shop no longer offers.
 */
export function priceBasket(lines: BasketLine[], items: PricedItem[]): { lines: PricedLine[]; totalCents: number } {
  const priced: PricedLine[] = [];
  for (const line of lines) {
    const item = items.find((candidate) => candidate.id === line.itemId);
    if (!item || line.quantity < 1) continue;
    let unitCents: number | null = null;
    let optionLabel: string | null = null;
    if (item.options.length === 0) {
      if (line.optionId === null) unitCents = item.priceCents;
    } else {
      const option = item.options.find((candidate) => candidate.id === line.optionId);
      if (option) {
        unitCents = option.priceCents;
        optionLabel = option.label;
      }
    }
    if (unitCents === null) continue;
    priced.push({ ...line, name: item.name, optionLabel, unitCents, lineCents: unitCents * line.quantity });
  }
  return { lines: priced, totalCents: priced.reduce((sum, line) => sum + line.lineCents, 0) };
}

/** The page's WhatsApp number, from a wa.me or api.whatsapp.com/send link; null when it has neither. */
export function whatsappNumber(links: { label: string; url: string }[]): string | null {
  for (const { url } of links) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      continue;
    }
    const host = parsed.hostname.toLowerCase();
    if (host === 'wa.me') {
      // Only a bare number or a /c/ number is a phone; wa.me/message/<code> and /qr/<code> are
      // business codes whose digits belong to no one's phone, and an order sent there reaches a stranger.
      const match = /^\/(?:c\/)?\+?(\d{8,15})\/?$/.exec(parsed.pathname);
      if (match) return match[1] ?? null;
    }
    if (host === 'api.whatsapp.com' && parsed.pathname === '/send') {
      const digits = (parsed.searchParams.get('phone') ?? '').replace(/\D/g, '');
      if (digits.length >= 8 && digits.length <= 15) return digits;
    }
  }
  return null;
}

export function basketMessage(shopName: string, basket: { lines: PricedLine[]; totalCents: number }, copy: ShopCopy): string {
  const lines = basket.lines.map(
    (line) => `• ${line.quantity} × ${line.name}${line.optionLabel ? ` (${line.optionLabel})` : ''} — ${formatRinggit(line.lineCents)}`,
  );
  return [copy.greeting(shopName), ...lines, copy.totalLine(formatRinggit(basket.totalCents))].join('\n');
}

export function whatsappOrderUrl(number: string, text: string): string {
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}

/** A one-shot line the product page leaves for the shop to say aloud: the page that said it is already gone. */
export const addedNoteKey = (handle: string) => `curios-added:${handle}`;

export function writeAddedNote(handle: string, text: string) {
  try {
    window.sessionStorage.setItem(addedNoteKey(handle), text);
  } catch {
    // Nothing to say it with; the basket itself is saved.
  }
}

/** Reads the note once and clears it. */
export function takeAddedNote(handle: string): string {
  try {
    const text = window.sessionStorage.getItem(addedNoteKey(handle)) ?? '';
    window.sessionStorage.removeItem(addedNoteKey(handle));
    return text;
  } catch {
    return '';
  }
}
