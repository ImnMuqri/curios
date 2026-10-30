import { OWNER_MAIL_FOOTER, renderMailHtml, type MailBlock, type MailCardPart } from './mail.js';
import { deliveryRow, rowsText, voucherRow } from './order-mail.js';
import { formatRinggit } from './store.js';

/**
 * The emails about digital items: what the buyer gets once the order is paid
 * (files, a link, codes, a class time), the reminder the day before a class, and
 * the owner's "Paid and sent". Laid out as the Emails board draws them; the
 * customer's two are sent as "{Shop} via Curios" (MailJobData.fromName).
 */

interface Mail {
  subject: string;
  text: string;
  html: string;
}

export type MailLang = 'en' | 'ms';

export interface DigitalMailItem {
  name: string;
  optionLabel: string | null;
  quantity: number;
  delivery: 'FILES' | 'LINK' | 'CODES' | 'SESSION';
  /** One per file; `url` is null when the order link is unknown, so the email carries no link. */
  downloads: { name: string; url: string | null; sizeBytes?: number | null }[];
  /** The line's link and note; `url` is the order's own redirect, or null when there is no order link. */
  link: { url: string | null; note: string | null } | null;
  /** The codes given to this line. */
  codes: string[];
  /** The class time as sold; `where` is the meeting link or the place. */
  session: { startsAt: Date; minutes: number; place: 'ONLINE' | 'IN_PERSON'; where: string; lineId?: string } | null;
}

export interface DigitalDeliveryMailInput {
  /** The page's language. */
  lang: MailLang;
  number: number;
  shopName: string;
  customerName: string;
  items: DigitalMailItem[];
  /** The order page, or null when the order link is unknown: the email then says to use the order page. */
  orderUrl: string | null;
  /** The shop's page address, for the footer ("curios.my/keklina"). */
  handle?: string;
  /** The shop's accent colour (Page.accentColor). */
  accent?: string;
  /** What the order came to; the tag then reads "Paid · RM214". */
  totalCents?: number;
  /** When the download links stop working. */
  downloadsUntil?: Date | null;
  appUrl?: string;
}

const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_MS = ['Jan', 'Feb', 'Mac', 'Apr', 'Mei', 'Jun', 'Jul', 'Ogo', 'Sep', 'Okt', 'Nov', 'Dis'];
const DAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAYS_MS = ['Ahd', 'Isn', 'Sel', 'Rab', 'Kha', 'Jum', 'Sab'];

/** "Sat 17 Oct, 3:00 pm" on the Malaysian clock (UTC+8, no daylight saving). */
export function sessionTimeText(startsAt: Date, lang: MailLang): string {
  const my = new Date(startsAt.getTime() + 8 * 3_600_000);
  const h = my.getUTCHours();
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  const suffix = lang === 'ms' ? (h < 12 ? 'pagi' : h < 19 ? 'petang' : 'malam') : h < 12 ? 'am' : 'pm';
  const days = lang === 'ms' ? DAYS_MS : DAYS_EN;
  const months = lang === 'ms' ? MONTHS_MS : MONTHS_EN;
  return `${days[my.getUTCDay()]} ${my.getUTCDate()} ${months[my.getUTCMonth()]}, ${hour12}:${String(my.getUTCMinutes()).padStart(2, '0')} ${suffix}`;
}

const SIZE_UNITS = ['B', 'KB', 'MB', 'GB'];
/** "4.2 MB", "220 KB". */
function sizeText(bytes: number): string {
  let n = bytes;
  let u = 0;
  while (n >= 1024 && u < SIZE_UNITS.length - 1) {
    n /= 1024;
    u += 1;
  }
  return `${u === 0 || n >= 100 ? Math.round(n) : Math.round(n * 10) / 10} ${SIZE_UNITS[u]}`;
}

/** "14 Nov", on the Malaysian clock. */
function dayText(d: Date, lang: MailLang): string {
  const my = new Date(d.getTime() + 8 * 3_600_000);
  return `${my.getUTCDate()} ${(lang === 'ms' ? MONTHS_MS : MONTHS_EN)[my.getUTCMonth()]}`;
}

/** "3:00 pm", on the Malaysian clock. */
export function clockText(startsAt: Date, lang: MailLang): string {
  return sessionTimeText(startsAt, lang).split(', ')[1]!;
}

const COPY = {
  en: {
    subject: (n: number, shop: string) => `Your order #${n} from ${shop}`,
    tag: 'Paid',
    tagTotal: (total: string) => `Paid · ${total}`,
    heading: (name: string) => `Here’s everything you bought, ${name}`,
    intro: 'Thanks for your order. It’s all below, and on your order page any time.',
    download: (file: string) => `Download ${file}`,
    downloadsNote: (until: string | null) => (until ? `Each link works 5 times, until ${until}.` : 'Each link works 5 times, for 30 days.'),
    downloadButton: 'Download',
    linkNote: 'This link is just for you. Please don’t share it.',
    joinButton: (place: 'ONLINE' | 'IN_PERSON') => (place === 'ONLINE' ? 'Join the class' : 'Get directions'),
    calendar: 'Add to calendar',
    online: 'Online',
    inPerson: (where: string) => `In person, ${where}`,
    remindsYou: 'We’ll remind you the day before.',
    orderLine: (n: number) => `Order #${n}`,
    openLink: 'Open the course',
    note: 'Note',
    code: 'Code',
    when: 'When',
    lasts: 'Lasts',
    minutes: (m: number) => `${m} minutes`,
    join: 'Join',
    place: 'Place',
    noLinks: 'Open your order page to get your downloads and links.',
    orderButton: 'Open your order page',
    footer: (shop: string, handle: string | undefined) =>
      `You get this because you ordered from ${handle ? `curios.my/${handle}` : shop}. ${shop} sees your name, number and email for this order only.`,
    remind: {
      subject: (item: string, time: string) => `Your ${item} is tomorrow, ${time}`,
      tag: (time: string) => `Tomorrow, ${time}`,
      heading: (item: string) => `Your ${item} is tomorrow`,
      intro: 'Here’s your link to join, and anything the shop asked us to send.',
      introPlace: 'Here’s where to go, and anything the shop asked us to send.',
      files: 'Files',
      cantMake: (shop: string) => `Can’t make it? Reply to ${shop} and they can move you to another time.`,
    },
  },
  ms: {
    subject: (n: number, shop: string) => `Tempahan #${n} anda dari ${shop}`,
    tag: 'Dibayar',
    tagTotal: (total: string) => `Dibayar · ${total}`,
    heading: (name: string) => `Ini semua yang anda beli, ${name}`,
    intro: 'Terima kasih atas tempahan anda. Semuanya ada di bawah, dan di halaman tempahan anda pada bila-bila masa.',
    download: (file: string) => `Muat turun ${file}`,
    downloadsNote: (until: string | null) => (until ? `Setiap pautan boleh digunakan 5 kali, sehingga ${until}.` : 'Setiap pautan boleh digunakan 5 kali, selama 30 hari.'),
    downloadButton: 'Muat turun',
    linkNote: 'Pautan ini untuk anda sahaja. Sila jangan kongsikannya.',
    joinButton: (place: 'ONLINE' | 'IN_PERSON') => (place === 'ONLINE' ? 'Sertai kelas' : 'Dapatkan arah'),
    calendar: 'Tambah ke kalendar',
    online: 'Dalam talian',
    inPerson: (where: string) => `Secara bersemuka, ${where}`,
    remindsYou: 'Kami akan mengingatkan anda sehari sebelum itu.',
    orderLine: (n: number) => `Tempahan #${n}`,
    openLink: 'Buka kursus',
    note: 'Nota',
    code: 'Kod',
    when: 'Bila',
    lasts: 'Tempoh',
    minutes: (m: number) => `${m} minit`,
    join: 'Sertai',
    place: 'Tempat',
    noLinks: 'Buka halaman tempahan anda untuk mendapatkan muat turun dan pautan.',
    orderButton: 'Buka halaman tempahan anda',
    footer: (shop: string, handle: string | undefined) =>
      `Anda terima ini kerana anda membuat tempahan dari ${handle ? `curios.my/${handle}` : shop}. ${shop} melihat nama, nombor dan e-mel anda untuk tempahan ini sahaja.`,
    remind: {
      subject: (item: string, time: string) => `${item} anda esok, ${time}`,
      tag: (time: string) => `Esok, ${time}`,
      heading: (item: string) => `${item} anda esok`,
      intro: 'Ini pautan untuk anda menyertai, dan apa-apa yang kedai minta kami hantar.',
      introPlace: 'Ini tempat untuk anda pergi, dan apa-apa yang kedai minta kami hantar.',
      files: 'Fail',
      cantMake: (shop: string) => `Tidak dapat hadir? Balas kepada ${shop} dan mereka boleh menukar anda ke masa lain.`,
    },
  },
} as const;

type Copy = (typeof COPY)[MailLang];

/** The time, where it is and how to get there, and the buttons: the same block in the delivery and the reminder. */
function sessionCard(
  s: NonNullable<DigitalMailItem['session']>,
  lang: MailLang,
  c: Copy,
  orderUrl: string | null,
  heading: string | undefined,
  note: string | undefined,
): { card: MailBlock; text: string[] } {
  const place = s.place === 'ONLINE' ? c.online : c.inPerson(s.where);
  const time = sessionTimeText(s.startsAt, lang);
  const detail = `${c.minutes(s.minutes)} · ${place}`;
  const calendar = orderUrl && s.lineId ? `${orderUrl}/calendar?line=${encodeURIComponent(s.lineId)}` : null;
  const join = s.place === 'ONLINE' && /^https?:\/\//i.test(s.where) ? s.where : null;
  const parts: MailCardPart[] = [{ kind: 'when', time, detail }];
  if (join || calendar) {
    const primary = join ? { label: c.joinButton('ONLINE'), href: join } : { label: c.calendar, href: calendar! };
    parts.push({ kind: 'actions', primary, ...(join && calendar ? { secondary: { label: c.calendar, href: calendar } } : {}) });
  }
  const text = [`${time}`, detail];
  if (join) text.push(`${c.joinButton('ONLINE')}: ${join}`);
  if (calendar) text.push(`${c.calendar}: ${calendar}`);
  return { card: { kind: 'card', heading, parts, note }, text };
}

/** Sent to the buyer, once the order is paid, and again when the owner resends it. */
export function digitalDeliveryMail(o: DigitalDeliveryMailInput): Mail {
  const c = COPY[o.lang];
  const subject = c.subject(o.number, o.shopName);
  const heading = c.heading(o.customerName);
  const blocks: MailBlock[] = [{ kind: 'p', text: c.intro }];
  const text: string[] = [`${heading}.`, '', c.intro];
  let needsOrderPage = false;
  const until = o.downloadsUntil ? dayText(o.downloadsUntil, o.lang) : null;

  for (const item of o.items) {
    const title = [item.name, item.optionLabel].filter(Boolean).join(', ') + (item.quantity > 1 ? ` × ${item.quantity}` : '');
    const parts: MailCardPart[] = [];
    let note: string | undefined;
    text.push('', title);
    if (item.session) {
      const built = sessionCard(item.session, o.lang, c, o.orderUrl, title, c.remindsYou);
      blocks.push(built.card);
      text.push(...built.text, c.remindsYou);
      continue;
    }
    for (const d of item.downloads) {
      if (!d.url) needsOrderPage = true;
      parts.push({ kind: 'file', name: d.name, size: d.sizeBytes ? sizeText(d.sizeBytes) : undefined, href: d.url, label: c.downloadButton });
      text.push(d.url ? `${c.download(d.name)}: ${d.url}` : d.name);
    }
    if (item.downloads.length > 0 && item.downloads.every((d) => d.url)) {
      note = c.downloadsNote(until);
      text.push(note);
    }
    if (item.link) {
      if (item.link.note) {
        parts.push({ kind: 'quote', text: `“${item.link.note}” · ${o.shopName}` });
        text.push(`${c.note}: ${item.link.note}`);
      }
      if (item.link.url) {
        parts.push({ kind: 'actions', primary: { label: c.openLink, href: item.link.url } });
        text.push(`${c.openLink}: ${item.link.url}`);
        note = c.linkNote;
        text.push(c.linkNote);
      } else needsOrderPage = true;
    }
    for (const code of item.codes) {
      parts.push({ kind: 'code', value: code });
      text.push(`${c.code}: ${code}`);
    }
    blocks.push({ kind: 'card', heading: title, parts, note });
  }
  if (o.orderUrl) {
    blocks.push({ kind: 'buttons', primary: { label: c.orderButton, href: o.orderUrl, tone: 'shop' } });
    text.push('', `${c.orderButton}: ${o.orderUrl}`);
  } else if (needsOrderPage) {
    blocks.push({ kind: 'small', text: c.noLinks });
    text.push('', c.noLinks);
  }

  return {
    subject,
    text: text.join('\n'),
    html: renderMailHtml({
      subject,
      shop: o.shopName,
      accent: o.accent,
      topRight: c.orderLine(o.number),
      tag: { label: o.totalCents !== undefined ? c.tagTotal(formatRinggit(o.totalCents)) : c.tag, tone: 'hijau' },
      heading,
      blocks,
      footer: c.footer(o.shopName, o.handle),
      appUrl: o.appUrl,
    }),
  };
}

export interface SessionReminderMailInput {
  lang: MailLang;
  number: number;
  shopName: string;
  handle?: string;
  /** The shop's accent colour (Page.accentColor). */
  accent?: string;
  /** The class as sold. */
  itemName: string;
  session: NonNullable<DigitalMailItem['session']>;
  /** The order's other files (a shopping list), with their download links. */
  files: { name: string; url: string | null; sizeBytes?: number | null }[];
  orderUrl: string | null;
  appUrl?: string;
}

/** Sent the day before a class (Malaysian calendar day), to the buyer. */
export function sessionReminderMail(o: SessionReminderMailInput): Mail {
  const c = COPY[o.lang];
  const r = c.remind;
  const clock = clockText(o.session.startsAt, o.lang);
  const subject = r.subject(o.itemName, clock);
  const heading = r.heading(o.itemName);
  const intro = o.session.place === 'ONLINE' ? r.intro : r.introPlace;
  const built = sessionCard(o.session, o.lang, c, o.orderUrl, undefined, undefined);
  const blocks: MailBlock[] = [{ kind: 'p', text: intro }, built.card];
  const text = [`${heading}.`, '', intro, '', ...built.text];
  if (o.files.length > 0) {
    blocks.push({ kind: 'card', heading: r.files, parts: o.files.map((f): MailCardPart => ({ kind: 'file', name: f.name, size: f.sizeBytes ? sizeText(f.sizeBytes) : undefined, href: f.url, label: c.downloadButton })) });
    text.push('', r.files);
    for (const f of o.files) text.push(f.url ? `${c.download(f.name)}: ${f.url}` : f.name);
  }
  if (o.orderUrl) {
    blocks.push({ kind: 'buttons', primary: { label: c.orderButton, href: o.orderUrl, tone: 'shop' } });
    text.push('', `${c.orderButton}: ${o.orderUrl}`);
  }
  blocks.push({ kind: 'small', text: r.cantMake(o.shopName) });
  text.push('', r.cantMake(o.shopName));
  return {
    subject,
    text: text.join('\n'),
    html: renderMailHtml({
      subject,
      shop: o.shopName,
      accent: o.accent,
      topRight: c.orderLine(o.number),
      tag: { label: r.tag(clock), tone: 'biru' },
      heading,
      blocks,
      footer: c.footer(o.shopName, o.handle),
      appUrl: o.appUrl,
    }),
  };
}

export interface PaidAndSentOwnerMailInput {
  number: number;
  totalCents: number;
  customerName: string;
  /** How it was paid, as stored: "FPX · Maybank2u". */
  via: string;
  ref: string | null;
  /** The customer's email, shown beside their name. */
  customerEmail?: string | null;
  lines: { itemName: string; optionLabel: string | null; quantity: number; lineCents: number }[];
  /** The owner's order screen, opened on this order. */
  url: string;
  appUrl?: string;
  /** What the order's voucher took off, in sen, and its code or name (as newOrderMail). */
  discountCents?: number;
  voucherLabel?: string | null;
  /** The order's delivery fee in sen, shown as its own row when there is one. */
  deliveryCents?: number;
}

/** Sent to the owner when an order of digital items only is paid online: it is already delivered, nothing to do. */
export function paidAndSentOwnerMail(o: PaidAndSentOwnerMailInput): Mail {
  const total = formatRinggit(o.totalCents);
  const subject = `New order #${o.number} · ${total} · Paid and sent`;
  const heading = `${o.customerName} bought ${total} of digital items`;
  const said = 'Paid online and sent to them straight away. There’s nothing for you to do.';
  const help = 'If they can’t find it, open the order and press Resend. Running low on voucher codes? Add more in Store.';
  const customer = o.customerEmail ? `${o.customerName} · ${o.customerEmail}` : o.customerName;
  const button = `Open order #${o.number}`;
  const paidWith = o.ref ? `${o.via} · Ref ${o.ref}` : o.via;
  const voucher = voucherRow(o);
  const delivery = deliveryRow(o);
  return {
    subject,
    text: [
      `${heading}.`,
      '',
      said,
      '',
      ...o.lines.map((l) => `${[l.itemName, l.optionLabel].filter(Boolean).join(', ')}, ${l.quantity}×: ${formatRinggit(l.lineCents)}`),
      ...rowsText(delivery, voucher),
      `Paid: ${total}`,
      `Customer: ${customer}`,
      `Paid with: ${paidWith}`,
      '',
      `${button}: ${o.url}`,
      '',
      help,
    ].join('\n'),
    html: renderMailHtml({
      subject,
      topRight: `Order #${o.number}`,
      tag: { label: 'Paid and sent', tone: 'hijau' },
      heading,
      blocks: [
        { kind: 'p', text: said },
        {
          kind: 'lines',
          rows: [
            ...o.lines.map((l) => ({
              name: l.itemName,
              detail: [l.optionLabel, `${l.quantity}×`].filter(Boolean).join(' · '),
              amount: formatRinggit(l.lineCents),
            })),
            ...(delivery ? [delivery] : []),
            ...(voucher ? [voucher] : []),
          ],
          total: { label: 'Paid', amount: total },
        },
        { kind: 'facts', rows: [['Customer', customer], ['Paid with', paidWith]] },
        { kind: 'buttons', primary: { label: button, href: o.url } },
        { kind: 'small', text: help },
      ],
      footer: OWNER_MAIL_FOOTER,
      appUrl: o.appUrl,
    }),
  };
}
