export interface LeadSlots {
  product: string | null;
  date: string | null;
  location: string | null;
}

export interface TranscriptLine {
  role: 'USER' | 'ASSISTANT';
  content: string;
}

/**
 * The message an owner actually receives, and the reason this product is worth
 * paying for.
 *
 * BACKEND.md: "Notification carries the transcript, not just the number. That
 * is the feature people pay for: she opens WhatsApp already knowing what they
 * want." So the transcript is the body, not an attachment or a link to a
 * dashboard that does not exist yet.
 */
export function buildNotification(input: {
  displayName: string;
  phone: string;
  transcript: TranscriptLine[];
  slots: LeadSlots;
}): { subject: string; text: string } {
  const { displayName, phone, transcript, slots } = input;

  // Digits only. wa.me refuses a plus and refuses separators, and a link that
  // opens WhatsApp on a broken number fails at the exact moment this product
  // is meant to be earning its keep.
  const waNumber = phone.replace(/\D/g, '');

  const reply = slots.product
    ? `Hi! Saya dari ${displayName}. Pasal ${slots.product} tadi —`
    : `Hi! Saya dari ${displayName}. Terima kasih sebab tanya tadi —`;
  const waLink = `https://wa.me/${waNumber}?text=${encodeURIComponent(reply)}`;

  const known = [
    slots.product ? `Product: ${slots.product}` : null,
    slots.date ? `When: ${slots.date}` : null,
    slots.location ? `Where: ${slots.location}` : null,
  ].filter((line): line is string => line !== null);

  // Attributed, because an owner reading this cannot otherwise tell their own
  // AI's words from the customer's -- which is the single thing they opened
  // the mail to find out.
  const lines = transcript.map(
    (line) => `${line.role === 'USER' ? 'Customer' : displayName}: ${line.content}`,
  );

  const text = [
    `Someone asked about your page and left their number.`,
    ``,
    `Number: ${phone}`,
    ...(known.length > 0 ? [``, ...known] : []),
    ``,
    `Reply on WhatsApp:`,
    waLink,
    ``,
    `What they asked:`,
    ...lines,
    ``,
  ].join('\n');

  return { subject: `New lead for ${displayName}`, text };
}
