import type { LeadSlots } from '@curios/db-read';

const lower = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

/**
 * A first WhatsApp message to a lead, drafted from what the chat picked out,
 * for the owner to edit before sending. In the page's language; anything but
 * 'ms' reads English. It says only what the lead said: never a price or a
 * promise the owner has not made.
 */
export function firstMessage(displayName: string, slots: LeadSlots | null, language: string): string {
  const s = slots ?? { product: null, date: null, location: null };
  const any = Boolean(s.product || s.date || s.location);

  if (language === 'ms') {
    let m = `Hai! Ini ${displayName}. Awak ada tanya dalam chat`;
    if (s.product) m += ` tentang ${lower(s.product)}`;
    if (s.date) m += ` untuk ${s.date}`;
    if (s.location) m += `, di ${s.location}`;
    return `${m}. ${any ? 'Boleh saya bantu. Bila sesuai untuk kita bincang?' : 'Ada apa yang saya boleh bantu?'}`;
  }

  let m = `Hi! This is ${displayName}. You asked in the chat`;
  if (s.product) m += ` about ${lower(s.product)}`;
  if (s.date) m += ` for ${s.date}`;
  if (s.location) m += `, in ${s.location}`;
  return `${m}. ${any ? 'Happy to help. When suits you to talk it through?' : 'How can I help?'}`;
}

/** wa.me wants digits only: no plus, no separators. */
export const waNumber = (e164: string) => e164.replace(/\D/g, '');
