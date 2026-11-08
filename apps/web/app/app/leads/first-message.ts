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

/**
 * A first WhatsApp message to someone who sent an enquiry from an Ask item in
 * the shop: by their name, about the item they asked after, with the date and
 * how many people when those were picked out of their message. Like the chat
 * one it names no price: the owner checks, then quotes.
 */
export function enquiryFirstMessage(
  displayName: string,
  enquiry: { name: string | null; item: string | null },
  slots: LeadSlots | null,
  language: string,
): string {
  const name = enquiry.name?.trim() || null;
  const date = slots?.date ?? null;
  const people = slots?.people ?? null;
  const details = `${date ? (language === 'ms' ? ` untuk ${date}` : ` for ${date}`) : ''}${people ? ` (${people})` : ''}`;

  if (language === 'ms') {
    const about = enquiry.item ? `bertanya tentang ${enquiry.item}` : 'bertanya';
    return `Hai${name ? ` ${name}` : ''}! Ini ${displayName}. Terima kasih sebab ${about}${details}. Saya semak dulu, nanti saya bagi tahu harganya ya.`;
  }

  const about = enquiry.item ? `asking about the ${enquiry.item}` : 'your enquiry';
  return `Hi${name ? ` ${name}` : ''}! This is ${displayName}. Thanks for ${about}${details}. Let me check the details and I'll come back to you with a price.`;
}

/** wa.me wants digits only: no plus, no separators. */
export const waNumber = (e164: string) => e164.replace(/\D/g, '');
