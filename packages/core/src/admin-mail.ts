import { renderMailHtml } from './mail.js';

/**
 * The two emails the Curios team's admin actions send to an owner: their page
 * was suspended, and their page is back. Built like plan-mail.ts. English, and
 * Malay first when the page's own language is `ms`, as the page's visitors see
 * the unavailable notice. The reason is the admin's own words and is quoted
 * verbatim.
 */

export const ADMIN_MAIL_FOOTER = 'You get this because it’s about your Curios page.';
export const ADMIN_MAIL_FOOTER_MS = 'Anda menerima ini kerana ia tentang halaman Curios anda.';

interface Mail {
  subject: string;
  text: string;
  html: string;
}

interface AdminMailInput {
  displayName: string;
  reason: string;
  appUrl: string;
  /** The page's language; Malay when `ms`, English otherwise. */
  language?: string;
}

const dashboardUrl = (appUrl: string) => `${appUrl.replace(/\/+$/, '')}/app`;

export function pageSuspendedMail(input: AdminMailInput): Mail {
  const ms = input.language === 'ms';
  const subject = ms ? 'Halaman anda telah digantung' : 'Your page has been suspended';
  const said = ms
    ? `${input.displayName} tidak lagi kelihatan kepada pengunjung kerana pasukan Curios telah menggantungnya.`
    : `${input.displayName} is no longer shown to visitors because the Curios team suspended it.`;
  const why = ms ? `Sebab: ${input.reason}` : `Reason: ${input.reason}`;
  const reply = ms
    ? 'Jika anda rasa ini satu kesilapan, balas emel ini dan kami akan menyemaknya.'
    : 'If you think this is a mistake, reply to this email and we will look again.';
  const url = dashboardUrl(input.appUrl);
  return {
    subject,
    text: [said, '', why, '', reply, '', url].join('\n'),
    html: renderMailHtml({
      subject,
      appUrl: input.appUrl,
      topRight: input.displayName,
      tag: { label: ms ? 'Digantung' : 'Suspended', tone: 'merah' },
      heading: subject,
      blocks: [
        { kind: 'p', text: said },
        { kind: 'p', text: why },
        { kind: 'buttons', primary: { label: ms ? 'Buka papan pemuka' : 'Open your dashboard', href: url } },
        { kind: 'small', text: reply },
      ],
      footer: ms ? ADMIN_MAIL_FOOTER_MS : ADMIN_MAIL_FOOTER,
    }),
  };
}

export function pageRestoredMail(input: AdminMailInput): Mail {
  const ms = input.language === 'ms';
  const subject = ms ? 'Halaman anda kembali' : 'Your page is back';
  const said = ms
    ? `${input.displayName} kelihatan semula kepada pengunjung. Penggantungan telah ditarik balik oleh pasukan Curios.`
    : `${input.displayName} is shown to visitors again. The Curios team lifted the suspension.`;
  const why = ms ? `Catatan: ${input.reason}` : `Note: ${input.reason}`;
  const url = dashboardUrl(input.appUrl);
  return {
    subject,
    text: [said, '', why, '', url].join('\n'),
    html: renderMailHtml({
      subject,
      appUrl: input.appUrl,
      topRight: input.displayName,
      tag: { label: ms ? 'Kembali' : 'Back', tone: 'hijau' },
      heading: subject,
      blocks: [
        { kind: 'p', text: said },
        { kind: 'p', text: why },
        { kind: 'buttons', primary: { label: ms ? 'Buka papan pemuka' : 'Open your dashboard', href: url } },
      ],
      footer: ms ? ADMIN_MAIL_FOOTER_MS : ADMIN_MAIL_FOOTER,
    }),
  };
}

export function reportWarningMail(input: AdminMailInput): Mail {
  const ms = input.language === 'ms';
  const subject = ms ? 'Tentang halaman anda di Curios' : 'About your page on Curios';
  const said = ms
    ? `Pasukan Curios menerima laporan tentang ${input.displayName} dan meminta anda menyemaknya. Halaman anda masih kelihatan kepada pengunjung.`
    : `The Curios team received reports about ${input.displayName} and is asking you to take a look. Your page stays live.`;
  const why = ms ? `Daripada pasukan kami: ${input.reason}` : `From our team: ${input.reason}`;
  const reply = ms
    ? 'Ada soalan? Balas emel ini dan kami akan membantu.'
    : 'Questions? Reply to this email and we will help.';
  const url = dashboardUrl(input.appUrl);
  return {
    subject,
    text: [said, '', why, '', reply, '', url].join('\n'),
    html: renderMailHtml({
      subject,
      appUrl: input.appUrl,
      topRight: input.displayName,
      tag: { label: ms ? 'Perlu disemak' : 'Please review', tone: 'amber' },
      heading: subject,
      blocks: [
        { kind: 'p', text: said },
        { kind: 'p', text: why },
        { kind: 'buttons', primary: { label: ms ? 'Buka papan pemuka' : 'Open your dashboard', href: url } },
        { kind: 'small', text: reply },
      ],
      footer: ms ? ADMIN_MAIL_FOOTER_MS : ADMIN_MAIL_FOOTER,
    }),
  };
}
