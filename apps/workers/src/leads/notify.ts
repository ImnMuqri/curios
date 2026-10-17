import { formatMalaysianPhone, OWNER_MAIL_FOOTER, renderMailHtml, type MailBlock } from '@curios/core';

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
 * Words a Malaysian customer types constantly and an English speaker does not.
 * Short, common, and mostly function words -- product nouns are exactly what
 * gets borrowed across languages, so they make poor markers.
 */
const MALAY_MARKERS = [
  'nak',
  'boleh',
  'ada',
  'berapa',
  'harga',
  'saya',
  'tak',
  'untuk',
  'hantar',
  'macam',
  'bila',
  'mana',
  'kena',
  'buka',
  'tutup',
  'dengan',
  'sini',
  'juga',
  'lagi',
  'sudah',
  'belum',
];

/** The same, the other way. Only reached when no Malay marker appeared. */
const ENGLISH_MARKERS = [
  'the',
  'is',
  'are',
  'you',
  'do',
  'does',
  'can',
  'how',
  'much',
  'want',
  'need',
  'have',
  'please',
  'thanks',
  'deliver',
  'delivery',
  'price',
  'order',
  'available',
  'for',
  'to',
];

function hasAny(text: string, markers: string[]): boolean {
  // Whole words only. "ada" must not match inside "Canada", and "to" must not
  // match inside "tomorrow".
  return markers.some((marker) => new RegExp(`\\b${marker}\\b`, 'i').test(text));
}

/**
 * Which language to prefill the owner's WhatsApp reply in.
 *
 * Malay by default, because this is a Malaysian product and that is where a
 * shop starts. English only when the customer clearly wrote English -- the
 * same rule FRONTEND.md already states for the AI itself: it answers in the
 * language it was asked in.
 *
 * A Malay marker anywhere wins, so rojak reads as Malay. "ada delivery?" is
 * how people actually type, and someone borrowing an English noun is still
 * speaking Malay.
 *
 * `visitorMessages` is the customer's side only. The shop's own answers
 * already mirror the customer's language, so counting them would echo the
 * question back and decide nothing.
 */
export function replyLanguage(visitorMessages: string[]): 'ms' | 'en' {
  const text = visitorMessages.join(' ');
  if (hasAny(text, MALAY_MARKERS)) return 'ms';
  if (hasAny(text, ENGLISH_MARKERS)) return 'en';
  return 'ms';
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
  /** The dashboard's address, for "See in Leads". */
  appUrl?: string;
  /** When the number was left, for the note beside it. */
  leftAt?: Date;
  /** On a free trial: which free lead this is, and of how many. */
  freeLead?: { nth: number; of: number } | null;
}): { subject: string; text: string; html: string } {
  const { displayName, phone, transcript, slots } = input;

  // Digits only. wa.me refuses a plus and refuses separators, and a link that
  // opens WhatsApp on a broken number fails at the exact moment this product
  // is meant to be earning its keep.
  const waNumber = phone.replace(/\D/g, '');

  // Written in each language, not translated from the other. DESIGN.md: "Malay
  // copy is written by a Malay speaker, not translated. If a string sounds
  // like a translation, it is wrong."
  const language = replyLanguage(
    transcript.filter((line) => line.role === 'USER').map((line) => line.content),
  );
  const reply =
    language === 'ms'
      ? slots.product
        ? `Hi! Saya dari ${displayName}. Pasal ${slots.product} tadi —`
        : `Hi! Saya dari ${displayName}. Terima kasih sebab tanya tadi —`
      : slots.product
        ? `Hi! ${displayName} here. About the ${slots.product} you asked about —`
        : `Hi! ${displayName} here. Thanks for your message earlier —`;
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

  const subject = `New lead for ${displayName}`;

  // The same email laid out as the design handoff's Emails board draws it,
  // with this email's own words: the number, what they are after, the
  // conversation, and one tap to reply.
  const leads = `${(input.appUrl ?? 'http://localhost:3000').replace(/\/+$/, '')}/app/leads`;
  const leftAt = input.leftAt
    ? `Left ${input.leftAt.toLocaleTimeString('en-MY', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kuala_Lumpur' }).replace(/\s/g, '').toLowerCase()}`
    : undefined;
  const blocks: MailBlock[] = [
    { kind: 'p', text: 'Someone asked about your page and left their number.' },
    { kind: 'number', value: formatMalaysianPhone(phone), note: leftAt },
    ...(known.length > 0
      ? [
          {
            kind: 'facts' as const,
            rows: [
              ...(slots.product ? [['Product', slots.product] as [string, string]] : []),
              ...(slots.date ? [['When', slots.date] as [string, string]] : []),
              ...(slots.location ? [['Where', slots.location] as [string, string]] : []),
            ],
          },
        ]
      : []),
    {
      kind: 'chat',
      lines: transcript.map((line) => ({ from: line.role === 'USER' ? ('visitor' as const) : ('page' as const), text: line.content })),
    },
    {
      kind: 'buttons',
      primary: { label: 'Reply on WhatsApp', href: waLink, tone: 'hijau' },
      secondary: { label: 'See in Leads', href: leads },
    },
    ...(input.freeLead
      ? [
          {
            kind: 'small' as const,
            text: `Lead ${input.freeLead.nth} of your ${input.freeLead.of} free leads. After ${input.freeLead.of}, the capture card stops appearing until you subscribe.`,
          },
        ]
      : []),
  ];

  const html = renderMailHtml({
    subject,
    topRight: 'From your page',
    tag: { label: 'New lead', tone: 'hijau' },
    heading: 'Someone wants you to message them',
    blocks,
    footer: OWNER_MAIL_FOOTER,
  });

  return { subject, text, html };
}
