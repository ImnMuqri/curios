import { createTransport } from 'nodemailer';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

export type Transport = {
  sendMail(options: { from: string; to: string; subject: string; text: string }): Promise<unknown>;
};

/**
 * The only module that knows how mail leaves this system.
 *
 * Local development points SMTP_* at Mailpit, which needs no account, so a
 * fresh clone completes a signup without configuring anything -- the property
 * BACKEND.md was protecting when it ruled out email on the login path.
 * Production points the same variables at a hosted sender, and nothing above
 * this line knows which, so the choice stays reversible.
 *
 * Plain text only, deliberately: three transactional messages carrying one link
 * each. An HTML template is a rendering dependency and a phishing-shaped email
 * for no gain.
 */
export function createMailer(transport?: Transport): Mailer {
  const resolved: Transport =
    transport ??
    createTransport({
      host: process.env.SMTP_HOST ?? 'localhost',
      port: Number(process.env.SMTP_PORT ?? 1075),
      secure: false,
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD ?? '' }
        : undefined,
    });

  return {
    async send(message: MailMessage): Promise<void> {
      await resolved.sendMail({
        from: process.env.MAIL_FROM ?? 'Curios <hello@curios.my>',
        to: message.to,
        subject: message.subject,
        text: message.text,
      });
    },
  };
}
