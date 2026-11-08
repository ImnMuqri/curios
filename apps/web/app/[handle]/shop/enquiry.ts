/**
 * An Ask item's enquiry, handed from the shop's sheet to the page's Ask chat
 * (HANDOFF "Shop: Ask items and enquiries", 8 Nov 2026). The sheet sends it,
 * leaves this in sessionStorage and goes to `/<handle>#ask`; the chat reads it
 * once, starts its thread with it and asks for the page's reply. Kept apart
 * from the sheet so the public page's first load carries only this.
 */
export interface EnquiryHandoff {
  conversationId: string;
  item: { name: string; photoUrl: string | null };
  /** The customer's message, as they typed it. */
  text: string;
}

export const enquiryKey = (handle: string) => `curios-enquiry:${handle.toLowerCase()}`;

export function writeEnquiryHandoff(handle: string, handoff: EnquiryHandoff) {
  try {
    window.sessionStorage.setItem(enquiryKey(handle), JSON.stringify(handoff));
  } catch {
    // Storage blocked: the enquiry is still sent and the shop still told; the chat just opens without it.
  }
}

/** Storage is the visitor's to edit, so the handoff is checked before the chat draws or sends anything from it. */
function isHandoff(value: unknown): value is EnquiryHandoff {
  if (typeof value !== 'object' || value === null) return false;
  const h = value as Record<string, unknown>;
  const item = h.item as Record<string, unknown> | null | undefined;
  return (
    typeof h.conversationId === 'string' &&
    h.conversationId !== '' &&
    h.conversationId.length <= 64 &&
    typeof h.text === 'string' &&
    typeof item === 'object' &&
    item !== null &&
    typeof item.name === 'string' &&
    (item.photoUrl === null || typeof item.photoUrl === 'string')
  );
}

/** Reads the handoff once and clears it, so a reload or a later visit does not send the enquiry's reply again. */
export function takeEnquiryHandoff(handle: string): EnquiryHandoff | null {
  try {
    const raw = window.sessionStorage.getItem(enquiryKey(handle));
    if (raw === null) return null;
    window.sessionStorage.removeItem(enquiryKey(handle));
    const parsed: unknown = JSON.parse(raw);
    return isHandoff(parsed) ? { conversationId: parsed.conversationId, item: { name: parsed.item.name, photoUrl: parsed.item.photoUrl }, text: parsed.text } : null;
  } catch {
    return null;
  }
}
