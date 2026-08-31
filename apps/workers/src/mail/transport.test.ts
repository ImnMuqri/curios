import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMailer, smtpOptions } from './transport.js';

function recordingTransport() {
  const sent: Array<Record<string, string>> = [];
  return {
    sent,
    transport: {
      async sendMail(options: { from: string; to: string; subject: string; text: string }) {
        sent.push(options);
        return {};
      },
    },
  };
}

const MAIL_KEYS = ['MAIL_FROM', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD'] as const;
let saved: Partial<Record<(typeof MAIL_KEYS)[number], string | undefined>> = {};

beforeEach(() => {
  saved = Object.fromEntries(MAIL_KEYS.map((k) => [k, process.env[k]]));
  for (const k of MAIL_KEYS) delete process.env[k];
});

afterEach(() => {
  // fileParallelism is off, so a leaked value would follow us into every later
  // test file in this package.
  for (const k of MAIL_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('createMailer', () => {
  it('sends the message with the configured sender', async () => {
    // Deliberately NOT the fallback in mailer.ts: if the two agree, the
    // assertion passes whether or not MAIL_FROM is ever read.
    process.env.MAIL_FROM = 'Curios Test <test@curios.test>';
    const { sent, transport } = recordingTransport();

    await createMailer(transport).send({
      to: 'nadia@example.com',
      subject: 'Confirm your email',
      text: 'https://curios.my/verify?token=abc',
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      from: 'Curios Test <test@curios.test>',
      to: 'nadia@example.com',
      subject: 'Confirm your email',
      text: 'https://curios.my/verify?token=abc',
    });
  });

  it('surfaces a transport failure rather than swallowing it', async () => {
    const transport = {
      async sendMail() {
        throw new Error('connection refused');
      },
    };

    // A silently dropped verification email is an account nobody can activate.
    await expect(
      createMailer(transport).send({ to: 'a@b.c', subject: 's', text: 't' }),
    ).rejects.toThrow('connection refused');
  });
});

describe('smtpOptions', () => {
  it('reaches Mailpit in cleartext, because local Mailpit offers no TLS', () => {
    process.env.SMTP_HOST = 'localhost';
    process.env.SMTP_PORT = '1075';

    expect(smtpOptions()).toMatchObject({
      host: 'localhost',
      port: 1075,
      secure: false,
      requireTLS: false,
      auth: undefined,
    });
  });

  it('uses implicit TLS on 465', () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_PORT = '465';
    process.env.SMTP_USER = 'apikey';
    process.env.SMTP_PASSWORD = 'secret';

    expect(smtpOptions()).toMatchObject({ port: 465, secure: true });
  });

  it('demands STARTTLS on 587 whenever credentials are in play', () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_PORT = '587';
    process.env.SMTP_USER = 'apikey';
    process.env.SMTP_PASSWORD = 'secret';

    // Without requireTLS, a server that does not advertise STARTTLS gets the
    // username and password in cleartext.
    expect(smtpOptions()).toMatchObject({
      port: 587,
      secure: false,
      requireTLS: true,
      auth: { user: 'apikey', pass: 'secret' },
    });
  });

  it('falls back to the Mailpit port when SMTP_PORT is set but empty', () => {
    process.env.SMTP_HOST = 'localhost';
    process.env.SMTP_PORT = '';

    // Number('') is 0, and nodemailer treats a falsy port as "use 587".
    expect(smtpOptions().port).toBe(1075);
  });
});
