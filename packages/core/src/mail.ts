/**
 * The HTML side of every email Curios sends, from the design handoff's Emails
 * board: the wordmark, an optional tag, a heading, the body, one button (or a
 * pair), and a footer saying why the email came. The plain-text body is still
 * written by each sender and goes alongside, so a client that shows text, or a
 * reader who prefers it, loses nothing.
 *
 * Tables and inline styles only, because that is what email clients render.
 * Every string is escaped here, so a sender can pass a visitor's own words
 * (a lead's transcript) without thinking about it, and a link must be http(s).
 */

import { readableOn, tintOf } from './bento.js';

/**
 * The palette, as literal values: email clients read no CSS variables. Copied
 * from packages/ui/src/tokens.css, the one home of these colours; change both.
 */
const C = {
  ink: '#191f2c',
  inkSoft: '#4b5060',
  body: '#3c4150',
  muted: '#696e7b',
  faint: '#8a8f9b',
  line: '#e9ebef',
  edge: '#d5d9e1',
  field: '#f1f3f6',
  well: '#f5f6f9',
  card: '#ffffff',
  paper: '#fafbfc',
  biru: '#2340c8',
  biruDeep: '#1a31a8',
  biruMuda: '#eaf0ff',
  hijau: '#1d6f5f',
  hijauDeep: '#123b33',
  hijauMuda: '#e8f3ef',
  amberInk: '#8f5c15',
  amberMuda: '#fdf0dc',
  merah: '#d8452f',
  merahMuda: '#fdecea',
  /** A shop's own colour in the emails to its customers (the Emails board's Kek Lina). */
  shop: '#b5294e',
} as const;

/** The shop's colour in one email: buttons and mark, the text on them, and a light tint of it. Set by renderMailHtml, which is synchronous. */
let accent = shopAccent(undefined);

/** A shop's accent (#rrggbb) for an email, or the board's crimson when it is absent or not a colour. */
export function shopAccent(hex: string | undefined): { bg: string; fg: string; tint: string } {
  const bg = hex && /^#[0-9a-f]{6}$/i.test(hex) ? hex.toLowerCase() : C.shop;
  return { bg, fg: readableOn(bg) === 'dark' ? C.ink : '#ffffff', tint: tintOf(bg, 0.06) };
}

const FONT = "'IBM Plex Sans', -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const MONO = "'IBM Plex Mono', ui-monospace, Menlo, Consolas, monospace";
/** The hosted wordmark is 161x56 at 2x; shown at half that. */
const WORDMARK_W = 81;

export type MailTone = 'biru' | 'hijau' | 'amber' | 'merah';

export interface MailButton {
  label: string;
  href: string;
  /** Blue by default; green for WhatsApp. */
  tone?: 'biru' | 'hijau' | 'shop';
}

export type MailBlock =
  | { kind: 'p'; text: string }
  | { kind: 'small'; text: string }
  /** One primary button, and optionally a quiet one beside it. */
  | { kind: 'buttons'; primary: MailButton; secondary?: { label: string; href: string } }
  /** "Button not working? Paste this into your browser:" and the address. */
  | { kind: 'fallback'; url: string }
  /** A phone number, large, in mono, with a note on the right. */
  | { kind: 'number'; value: string; note?: string }
  /** A conversation: the visitor's turns on the right, the page's on the left. */
  | { kind: 'chat'; lines: { from: 'visitor' | 'page'; text: string }[] }
  /** A boxed section of a customer's order: a heading, then files, a time, buttons, a code or a note. */
  | { kind: 'card'; heading?: string; parts: MailCardPart[]; note?: string }
  /** Label and value rows. */
  | { kind: 'facts'; rows: [string, string][] }
  /** A boxed list of what was bought, a detail under each name and an amount on the right, and a total row. */
  | { kind: 'lines'; rows: { name: string; detail: string; amount: string }[]; total: { label: string; amount: string } };

export type MailCardPart =
  /** A file row: its type, name and size, and a Download button (a name alone when there is no link). */
  | { kind: 'file'; name: string; size?: string; href: string | null; label: string }
  /** The time, large, with a line under it. */
  | { kind: 'when'; time: string; detail: string }
  | { kind: 'actions'; primary: MailButton; secondary?: { label: string; href: string } }
  | { kind: 'code'; value: string }
  | { kind: 'quote'; text: string };

export interface MailContent {
  /** The shop's accent colour (#rrggbb) for its buttons and mark; the board's crimson when absent or invalid. */
  accent?: string;
  /** A shop's name: the email then opens with the shop's mark, not Curios' wordmark. */
  shop?: string;
  /** The inbox line, also the <title>. */
  subject: string;
  /** A short line at the top right, beside the wordmark ("From your page"). */
  topRight?: string;
  tag?: { label: string; tone: MailTone };
  heading: string;
  blocks: MailBlock[];
  /** Why this email came. */
  footer: string;
  /** The site's address, where the hosted wordmark image lives. Defaults to production. */
  appUrl?: string;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** A link's address, escaped, and only if it is http(s): anything else becomes "#". */
function safeHref(href: string): string {
  return /^https?:\/\//i.test(href) ? escapeHtml(href) : '#';
}

/** Text with its line breaks kept. */
function lines(text: string): string {
  return escapeHtml(text).replace(/\n/g, '<br>');
}

const TAGS: Record<MailTone, { bg: string; fg: string }> = {
  biru: { bg: C.biruMuda, fg: C.biru },
  hijau: { bg: C.hijauMuda, fg: C.hijau },
  amber: { bg: C.amberMuda, fg: C.amberInk },
  merah: { bg: C.merahMuda, fg: C.merah },
};

function button(b: MailButton): string {
  const bg = b.tone === 'hijau' ? C.hijau : b.tone === 'shop' ? accent.bg : C.biru;
  const fg = b.tone === 'shop' ? accent.fg : '#ffffff';
  return `<a href="${safeHref(b.href)}" style="display:inline-block;padding:13px 24px;margin:10px 6px 4px 0;border-radius:999px;background:${bg};color:${fg};font-family:${FONT};font-size:15px;font-weight:600;line-height:20px;text-decoration:none;">${escapeHtml(b.label)}</a>`;
}

function quietButton(b: { label: string; href: string }): string {
  return `<a href="${safeHref(b.href)}" style="display:inline-block;padding:12px 20px;margin:10px 0 4px 0;border-radius:999px;border:1px solid ${C.edge};background:#ffffff;color:${C.ink};font-family:${FONT};font-size:15px;font-weight:600;line-height:20px;text-decoration:none;">${escapeHtml(b.label)}</a>`;
}

function pill(label: string, href: string, ghost = false): string {
  const bg = ghost ? C.field : accent.bg;
  const fg = ghost ? C.ink : accent.fg;
  return `<a href="${safeHref(href)}" style="display:inline-block;padding:9px 16px;margin:0 8px 8px 0;border-radius:999px;background:${bg};color:${fg};font-family:${FONT};font-size:13px;font-weight:600;line-height:18px;text-decoration:none;">${escapeHtml(label)}</a>`;
}

function cardPart(p: MailCardPart): string {
  switch (p.kind) {
    case 'file': {
      const ext = (p.name.includes('.') ? p.name.split('.').pop()! : '').slice(0, 4).toUpperCase();
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0;border-top:1px solid ${C.line};"><tr><td width="34" style="padding:8px 12px 8px 0;"><div style="width:34px;height:34px;border-radius:8px;background:${C.field};color:${C.inkSoft};font-family:${MONO};font-size:10px;line-height:34px;text-align:center;">${escapeHtml(ext)}</div></td><td style="padding:8px 0;font-family:${FONT};"><div style="font-size:13.5px;font-weight:500;line-height:18px;color:${C.ink};word-break:break-all;">${escapeHtml(p.name)}</div>${p.size ? `<div style="font-size:12px;line-height:16px;color:${C.muted};">${escapeHtml(p.size)}</div>` : ''}</td>${p.href ? `<td align="right" style="padding:8px 0 8px 12px;white-space:nowrap;">${pill(p.label, p.href).replace('margin:0 8px 8px 0', 'margin:0')}</td>` : ''}</tr></table>`;
    }
    case 'when': {
      return `<p style="margin:0 0 12px;font-family:${FONT};font-size:13px;line-height:20px;color:${C.muted};"><b style="display:block;font-size:17px;font-weight:600;line-height:24px;color:${C.ink};">${escapeHtml(p.time)}</b>${lines(p.detail)}</p>`;
    }
    case 'actions':
      return `<div style="margin:0;">${pill(p.primary.label, p.primary.href)}${p.secondary ? pill(p.secondary.label, p.secondary.href, true) : ''}</div>`;
    case 'code':
      return `<div style="margin:0;padding:12px 14px;border-radius:12px;background:${accent.tint};font-family:${MONO};font-size:18px;font-weight:500;letter-spacing:1.4px;text-align:center;color:${C.ink};">${escapeHtml(p.value)}</div>`;
    case 'quote':
      return `<p style="margin:0 0 12px;font-family:${FONT};font-size:13.5px;line-height:20px;color:${C.inkSoft};">${lines(p.text)}</p>`;
  }
}

function block(b: MailBlock): string {
  switch (b.kind) {
    case 'p':
      return `<p style="margin:0 0 12px;font-family:${FONT};font-size:15px;line-height:24px;color:${C.body};">${lines(b.text)}</p>`;
    case 'small':
      return `<p style="margin:18px 0 0;font-family:${FONT};font-size:13px;line-height:20px;color:${C.muted};">${lines(b.text)}</p>`;
    case 'buttons':
      return `<div style="margin:0;">${button(b.primary)}${b.secondary ? quietButton(b.secondary) : ''}</div>`;
    case 'fallback':
      return `<p style="margin:18px 0 0;font-family:${FONT};font-size:13px;line-height:20px;color:${C.muted};">Button not working? Paste this into your browser:</p><p style="margin:6px 0 0;padding:10px 12px;border-radius:10px;background:${C.well};font-family:${MONO};font-size:12px;line-height:18px;color:${C.biruDeep};word-break:break-all;">${escapeHtml(b.url)}</p>`;
    case 'number':
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0 8px;border-collapse:separate;border-radius:14px;background:${C.hijauMuda};"><tr><td style="padding:14px 16px;font-family:${MONO};font-size:20px;font-weight:500;color:${C.hijauDeep};">${escapeHtml(b.value)}</td>${b.note ? `<td align="right" style="padding:14px 16px;font-family:${FONT};font-size:12.5px;color:${C.hijau};white-space:nowrap;">${escapeHtml(b.note)}</td>` : ''}</tr></table>`;
    case 'chat':
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:10px 0 8px;border-collapse:separate;border-radius:14px;background:${C.well};"><tr><td style="padding:14px;">${b.lines
        .map((line) =>
          line.from === 'visitor'
            ? `<div style="text-align:right;margin:0 0 6px;"><span style="display:inline-block;max-width:86%;padding:8px 12px;border-radius:14px 14px 4px 14px;background:${C.ink};color:${C.paper};font-family:${FONT};font-size:13.5px;line-height:20px;text-align:left;">${lines(line.text)}</span></div>`
            : `<div style="text-align:left;margin:0 0 6px;"><span style="display:inline-block;max-width:86%;padding:8px 12px;border-radius:14px 14px 14px 4px;background:#ffffff;border:1px solid ${C.line};color:${C.ink};font-family:${FONT};font-size:13.5px;line-height:20px;">${lines(line.text)}</span></div>`,
        )
        .join('')}</td></tr></table>`;
    case 'card':
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0 0;border-collapse:separate;border:1px solid ${C.line};border-radius:14px;"><tr><td style="padding:16px;">${b.heading ? `<p style="margin:0 0 10px;font-family:${FONT};font-size:14.5px;font-weight:600;line-height:20px;color:${C.ink};">${escapeHtml(b.heading)}</p>` : ''}${b.parts.map(cardPart).join('')}${b.note ? `<p style="margin:8px 0 0;font-family:${FONT};font-size:12.5px;line-height:18px;color:${C.muted};">${lines(b.note)}</p>` : ''}</td></tr></table>`;
    case 'facts':
      return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:14px 0 6px;">${b.rows
        .map(
          ([label, value]) =>
            `<tr><td style="padding:4px 16px 4px 0;font-family:${FONT};font-size:14px;color:${C.muted};vertical-align:top;white-space:nowrap;">${escapeHtml(label)}</td><td style="padding:4px 0;font-family:${FONT};font-size:14px;font-weight:500;color:${C.ink};">${lines(value)}</td></tr>`,
        )
        .join('')}</table>`;
    case 'lines':
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0 8px;border-collapse:separate;border:1px solid ${C.line};border-radius:14px;">${b.rows
        .map(
          (row, i) =>
            `<tr><td style="padding:12px 14px;${i > 0 ? `border-top:1px solid ${C.line};` : ''}"><div style="font-family:${FONT};font-size:14px;font-weight:500;line-height:20px;color:${C.ink};">${escapeHtml(row.name)}</div><div style="font-family:${FONT};font-size:12.5px;line-height:18px;color:${C.muted};">${escapeHtml(row.detail)}</div></td><td align="right" style="padding:12px 14px;${i > 0 ? `border-top:1px solid ${C.line};` : ''}font-family:${FONT};font-size:14px;font-weight:500;color:${C.ink};white-space:nowrap;">${escapeHtml(row.amount)}</td></tr>`,
        )
        .join(
          '',
        )}<tr><td style="padding:12px 14px;border-top:1px solid ${C.line};border-radius:0 0 0 14px;background:${C.paper};font-family:${FONT};font-size:14px;font-weight:600;color:${C.ink};">${escapeHtml(b.total.label)}</td><td align="right" style="padding:12px 14px;border-top:1px solid ${C.line};border-radius:0 0 14px 0;background:${C.paper};font-family:${FONT};font-size:16px;font-weight:600;color:${C.ink};white-space:nowrap;">${escapeHtml(b.total.amount)}</td></tr></table>`;
  }
}

/** The whole email as HTML, one document, ready to send. */
export function renderMailHtml(mail: MailContent): string {
  accent = shopAccent(mail.accent);
  const appUrl = (mail.appUrl ?? 'https://curios.my').replace(/\/+$/, '');
  const tag = mail.tag
    ? `<span style="display:inline-block;padding:3px 10px;border-radius:999px;background:${TAGS[mail.tag.tone].bg};color:${TAGS[mail.tag.tone].fg};font-family:${FONT};font-size:12px;font-weight:600;line-height:18px;">&#9679;&nbsp;${escapeHtml(mail.tag.label)}</span>`
    : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(mail.subject)}</title>
<style>
@media (max-width: 480px) {
  .px { padding-left: 20px !important; padding-right: 20px !important; }
  .outer { padding: 0 !important; }
  .paper { border-radius: 0 !important; }
}
</style>
</head>
<body style="margin:0;padding:0;background:${C.field};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.field};">
<tr><td align="center" class="outer" style="padding:36px 12px 48px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="paper" style="max-width:600px;border-collapse:separate;border-radius:18px;background:#ffffff;">
<tr><td class="px" style="padding:28px 36px 0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
${mail.shop ? `<td style="font-family:'Bricolage Grotesque',${FONT};font-size:20px;font-weight:700;letter-spacing:-0.4px;color:${C.ink};"><span style="display:inline-block;width:32px;height:32px;margin-right:10px;border-radius:16px;background:${accent.bg};color:${accent.fg};font-size:15px;line-height:32px;text-align:center;vertical-align:middle;">${escapeHtml([...mail.shop][0]?.toUpperCase() ?? '')}</span><span style="vertical-align:middle;">${escapeHtml(mail.shop)}</span></td>` : `<td><img src="${escapeHtml(appUrl)}/email/wordmark@2x.png" width="${WORDMARK_W}" height="28" alt="curios" style="display:block;border:0"></td>`}
${mail.topRight ? `<td align="right" style="font-family:${FONT};font-size:12.5px;color:${C.muted};">${escapeHtml(mail.topRight)}</td>` : ''}
</tr></table>
</td></tr>
<tr><td class="px" style="padding:28px 36px 32px;">
${tag}
<h1 style="margin:${mail.tag ? '14px' : '0'} 0 8px;font-family:${FONT};font-size:24px;font-weight:600;line-height:30px;letter-spacing:-0.3px;color:${C.ink};">${escapeHtml(mail.heading)}</h1>
${mail.blocks.map(block).join('\n')}
</td></tr>
<tr><td class="px" style="padding:20px 36px 26px;border-top:1px solid ${C.line};font-family:${FONT};font-size:12.5px;line-height:20px;color:${C.faint};">${lines(mail.footer)}<br>Curios &middot; curios.my &middot; Kuala Lumpur</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

/** Why an account email came: someone used this address on Curios. */
export const ACCOUNT_MAIL_FOOTER = 'You get this because someone used this address on Curios.';
/** Why an owner email came, and where to turn it off. */
export const OWNER_MAIL_FOOTER = 'You get this because this email is on in Settings, under Notifications.';
