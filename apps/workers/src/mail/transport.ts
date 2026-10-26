import { createTransport } from 'nodemailer';
import type { MailJobData } from '@curios/core';

export type MailMessage = MailJobData;

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

export type Transport = {
  sendMail(options: { from: string; to: string; subject: string; text: string; html?: string }): Promise<unknown>;
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
 * Production points the same variables at a hosted sender, and nothing above
 * this line knows which, so the choice stays reversible.
 *
 * Plain text always, and HTML alongside when the sender laid the email out
 * (renderMailHtml in @curios/core, the design handoff's Emails board). The
 * text is the whole message, so a client that shows only text loses nothing.
 */
export function createMailer(transport?: Transport): Mailer {
  const resolved: Transport = transport ?? createTransport(smtpOptions());

  return {
    async send(message: MailMessage): Promise<void> {
      await resolved.sendMail({
        from: senderFor(message.fromName, process.env.MAIL_FROM ?? 'Curios <hello@curios.my>'),
        to: message.to,
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
      });
    },
  };
}
