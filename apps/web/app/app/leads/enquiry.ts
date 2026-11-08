import type { OwnerLead } from '@curios/db-read';

/** How the API opens an enquiry's conversation: `Enquiry from the shop: <item>. <their message>`. */
const OPENING = 'Enquiry from the shop: ';

/**
 * The item an enquiry was about: the item's own name, or, once the item was
 * removed, the name written into the conversation's first message. Null for a
 * chat lead, or when neither can be read.
 */
export function enquiryItemName(lead: Pick<OwnerLead, 'enquiry' | 'transcript'>): string | null {
  if (!lead.enquiry) return null;
  if (lead.enquiry.item) return lead.enquiry.item.name;
  const first = lead.transcript[0];
  if (first?.role !== 'USER' || !first.content.startsWith(OPENING)) return null;
  const rest = first.content.slice(OPENING.length);
  const note = lead.enquiry.note;
  // The message follows the name after ". ", and may hold full stops of its own: cut it off whole when it is known.
  const cut = note && rest.endsWith(`. ${note}`) ? rest.length - note.length - 2 : rest.indexOf('. ');
  const name = (cut >= 0 ? rest.slice(0, cut) : rest).trim();
  return name || null;
}

/** A lead's line in the list: an enquiry's item and date; a chat lead's product, date and place. */
export function leadSummary(lead: Pick<OwnerLead, 'enquiry' | 'transcript' | 'slots'>): string {
  const slots = lead.slots;
  if (lead.enquiry) return [enquiryItemName(lead) ?? slots?.product, slots?.date].filter(Boolean).join(' · ');
  return [slots?.product, slots?.date, slots?.location].filter(Boolean).join(' · ');
}
