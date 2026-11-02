import { createTransport } from 'nodemailer';
import type { MailJobData } from '@curios/core';
import { supportAddress } from '@curios/core/support';

export type MailMessage = MailJobData;

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

export type Transport = {
  sendMail(options: {
    from: string;
    to: string;
    subject: string;
    text: string;
    html?: string;
    replyTo?: string;
    messageId?: string;
    inReplyTo?: string;
    references?: string[];
  }): Promise<unknown>;
};

/** Mailpit's SMTP port in docker-compose.yml, offset from the default for the
 *  same reason Postgres and Redis are. */
const MAILPIT_PORT = 1075;

export interface SmtpOptions {
  host: string;
  port: number;
  secure: boolean;
  requireTLS: boolean;
  auth: { user: string; pass: string } | undefined;
}

/**
 * How this process connects to an SMTP server, resolved from the environment.
 *
 * Split out from `createMailer` so the TLS decision is testable without opening
 * a socket. It is the part worth testing: the same variables point at a
 * credential-free Mailpit locally and at a hosted sender in production, and
 * those two want opposite transport settings.
 */
export function smtpOptions(): SmtpOptions {
  // Number('') is 0 and nodemailer reads a falsy port as "use 587", so an
  // SMTP_PORT that is present but empty would silently reach the wrong port.
  const parsed = Number.parseInt(process.env.SMTP_PORT ?? '', 10);
  const port = Number.isInteger(parsed) && parsed > 0 ? parsed : MAILPIT_PORT;

  const user = process.env.SMTP_USER;
  const auth = user ? { user, pass: process.env.SMTP_PASSWORD ?? '' } : undefined;

  return {
    host: process.env.SMTP_HOST ?? 'localhost',
    port,
    // 465 is implicit TLS; every other port negotiates upward or stays plain.
    secure: port === 465,
    // Only ever cleartext where there is nothing to protect. Once credentials
    // are configured, a server that does not offer STARTTLS must fail the
    // connection rather than receive the password in the clear. Local Mailpit
    // has no credentials and no TLS, so it stays reachable.
    requireTLS: Boolean(auth) && port !== 465,
    auth,
  };
}

type SendOptions = Parameters<Transport['sendMail']>[0];
type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<Response>;

/**
 * Resend's sending API (https://resend.com/docs/api-reference/emails/send-email), over HTTPS.
 * Production runs on Railway, whose plan blocks outbound SMTP (25, 465 and 587): every
 * SMTP send there timed out. A refusal throws with the status and Resend's error name
 * only, since its message can carry the recipient's address.
 */
export function resendTransport(apiKey: string, fetch: Fetch = globalThis.fetch): Transport {
  return {
    async sendMail(options: SendOptions) {
      const headers: Record<string, string> = {
        ...(options.messageId ? { 'Message-ID': options.messageId } : {}),
        ...(options.inReplyTo ? { 'In-Reply-To': options.inReplyTo } : {}),
        ...(options.references?.length ? { References: options.references.join(' ') } : {}),
      };
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: options.from,
          to: [options.to],
          subject: options.subject,
          text: options.text,
          ...(options.html ? { html: options.html } : {}),
          ...(options.replyTo ? { reply_to: options.replyTo } : {}),
          ...(Object.keys(headers).length > 0 ? { headers } : {}),
        }),
      });
      if (!response.ok) {
        const name = ((await response.json().catch(() => null)) as { name?: unknown } | null)?.name;
        throw new Error(`Resend refused the email: ${response.status}${typeof name === 'string' ? ` ${name}` : ''}`);
      }
      return response.json();
    },
  };
}

/**
 * How mail leaves this process: Resend's API in production (RESEND_API_KEY, which the
 * support worker already needs), SMTP everywhere else. Outside production it stays SMTP
 * even with a key set, so a developer's key never mails a real address instead of Mailpit.
 */
export function mailTransport(): { kind: 'resend' | 'smtp'; transport: Transport } {
  const apiKey = process.env.RESEND_API_KEY;
  if (apiKey && process.env.NODE_ENV === 'production') return { kind: 'resend', transport: resendTransport(apiKey) };
  return { kind: 'smtp', transport: createTransport(smtpOptions()) };
}

/** `"Kek Lina via Curios" <orders@curios.my>`: the shop's name, made safe to sit in a header, over the configured address. */
export function senderFor(fromName: string | undefined, configured: string): string {
  const name = [...(fromName ?? '')]
    .map((ch) => (ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 || ch === '"' || ch === '\\' || ch === '<' || ch === '>' ? ' ' : ch))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  if (!name) return configured;
  const address = /<([^>]+)>/.exec(configured)?.[1] ?? configured.trim();
  return `"${name} via Curios" <${address}>`;
}

/**
 * The only module that knows how mail leaves this system.
 *
 * Local development points SMTP_* at Mailpit, which needs no account, so a
 * fresh clone completes a signup without configuring anything -- the property
 * BACKEND.md was protecting when it ruled out email on the login path.
 * Production sends through Resend's API instead (mailTransport), and nothing
 * above this line knows which, so the choice stays reversible.
 *
 * Plain text always, and HTML alongside when the sender laid the email out
 * (renderMailHtml in @curios/core, the design handoff's Emails board). The
 * text is the whole message, so a client that shows only text loses nothing.
 *
 * Every email carries a Reply-To: the job's own (a customer's email names the
 * shop's owner) or else support, so a reply never lands in a mailbox nobody
 * reads. A `from: 'support'` job is the admin answering from the inbox: it goes
 * out as Curios Support whatever fromName says, with its threading headers.
 */
export function createMailer(transport?: Transport): Mailer {
  const resolved: Transport = transport ?? mailTransport().transport;

  return {
    async send(message: MailMessage): Promise<void> {
      await resolved.sendMail({
        from:
          message.from === 'support'
            ? `Curios Support <${supportAddress()}>`
            : senderFor(message.fromName, process.env.MAIL_FROM ?? 'Curios <hello@curios.my>'),
        to: message.to,
        subject: message.subject,
        text: message.text,
        replyTo: message.replyTo ?? supportAddress(),
        ...(message.html ? { html: message.html } : {}),
        ...(message.messageId ? { messageId: message.messageId } : {}),
        ...(message.inReplyTo ? { inReplyTo: message.inReplyTo } : {}),
        ...(message.references?.length ? { references: message.references } : {}),
      });
    },
  };
}
