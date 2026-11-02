import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMailer, mailTransport, resendTransport, senderFor, smtpOptions } from './transport.js';

function recordingTransport() {
  const sent: Array<Record<string, unknown>> = [];
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

const MAIL_KEYS = ['MAIL_FROM', 'SUPPORT_EMAIL', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD'] as const;
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

  it('sends the laid-out HTML alongside the text when there is one, and none when there is not', async () => {
    const { sent, transport } = recordingTransport();
    const mailer = createMailer(transport);

    await mailer.send({ to: 'nadia@example.com', subject: 'Confirm your email', text: 'plain', html: '<p>laid out</p>' });
    await mailer.send({ to: 'nadia@example.com', subject: 'Confirm your email', text: 'plain' });

    expect(sent[0]).toMatchObject({ text: 'plain', html: '<p>laid out</p>' });
    expect(sent[1]).not.toHaveProperty('html');
  });

  it('sets Reply-To to support on a plain job, and keeps the one a job names', async () => {
    const { sent, transport } = recordingTransport();
    const mailer = createMailer(transport);

    await mailer.send({ to: 'nadia@example.com', subject: 's', text: 't' });
    await mailer.send({ to: 'mira@example.com', subject: 's', text: 't', replyTo: 'owner@x.test' });

    expect(sent[0]).toMatchObject({ replyTo: 'support@curios.my' });
    expect(sent[1]).toMatchObject({ replyTo: 'owner@x.test' });
  });

  it('sends a support job from Curios Support and ignores fromName', async () => {
    const { sent, transport } = recordingTransport();

    await createMailer(transport).send({ to: 'nadia@example.com', subject: 's', text: 't', from: 'support', fromName: 'Kek Lina' });

    expect(sent[0]).toMatchObject({ from: 'Curios Support <support@curios.my>' });
  });

  it('passes the threading headers through, and sets none when absent', async () => {
    const { sent, transport } = recordingTransport();
    const mailer = createMailer(transport);

    await mailer.send({
      to: 'nadia@example.com',
      subject: 's',
      text: 't',
      messageId: '<new@curios.my>',
      inReplyTo: '<old@x.test>',
      references: ['<first@x.test>', '<old@x.test>'],
    });
    await mailer.send({ to: 'nadia@example.com', subject: 's', text: 't' });

    expect(sent[0]).toMatchObject({ messageId: '<new@curios.my>', inReplyTo: '<old@x.test>', references: ['<first@x.test>', '<old@x.test>'] });
    expect(sent[1]).not.toHaveProperty('messageId');
    expect(sent[1]).not.toHaveProperty('inReplyTo');
    expect(sent[1]).not.toHaveProperty('references');
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

describe('senderFor', () => {
  it('reads "{Shop} via Curios" at the configured address, and cannot be bent by the shop name', () => {
    expect(senderFor('Kek Lina', 'Curios <hello@curios.my>')).toBe('"Kek Lina via Curios" <hello@curios.my>');
    expect(senderFor('Kek "Lina"\r\nBcc: x@y.z <evil>', 'hello@curios.my')).toBe('"Kek Lina Bcc: x@y.z evil via Curios" <hello@curios.my>');
    expect(senderFor(undefined, 'Curios <hello@curios.my>')).toBe('Curios <hello@curios.my>');
    expect(senderFor('  ', 'Curios <hello@curios.my>')).toBe('Curios <hello@curios.my>');
  });
});

describe('resendTransport', () => {
  function recordingFetch(status = 200, body: unknown = { id: 'e1' }) {
    const calls: Array<{ url: string; init: { method: string; headers: Record<string, string>; body: string } }> = [];
    const fetch = async (url: string, init: { method: string; headers: Record<string, string>; body: string }) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    };
    return { calls, fetch };
  }

  it('posts the email to Resend over HTTPS, with its reply-to and threading headers', async () => {
    const { calls, fetch } = recordingFetch();
    await resendTransport('re_key', fetch).sendMail({
      from: 'Curios Support <support@curios.my>',
      to: 'nadia@example.com',
      subject: 'Re: Help',
      text: 'plain',
      html: '<p>laid out</p>',
      replyTo: 'support@curios.my',
      messageId: '<a@curios.my>',
      inReplyTo: '<b@mail.example>',
      references: ['<c@mail.example>', '<b@mail.example>'],
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://api.resend.com/emails');
    expect(calls[0]!.init.method).toBe('POST');
    expect(calls[0]!.init.headers.Authorization).toBe('Bearer re_key');
    expect(JSON.parse(calls[0]!.init.body)).toEqual({
      from: 'Curios Support <support@curios.my>',
      to: ['nadia@example.com'],
      subject: 'Re: Help',
      text: 'plain',
      html: '<p>laid out</p>',
      reply_to: 'support@curios.my',
      headers: { 'Message-ID': '<a@curios.my>', 'In-Reply-To': '<b@mail.example>', References: '<c@mail.example> <b@mail.example>' },
    });
  });

  it('sends no html or headers it was not given', async () => {
    const { calls, fetch } = recordingFetch();
    await resendTransport('re_key', fetch).sendMail({ from: 'Curios <hello@curios.my>', to: 'nadia@example.com', subject: 'Hi', text: 'plain' });
    expect(JSON.parse(calls[0]!.init.body)).toEqual({ from: 'Curios <hello@curios.my>', to: ['nadia@example.com'], subject: 'Hi', text: 'plain' });
  });

  it('throws on a refusal with the status and Resend’s error name, never its message', async () => {
    const { fetch } = recordingFetch(422, { statusCode: 422, name: 'validation_error', message: 'Invalid `to` field: nadia@example.com' });
    const sending = resendTransport('re_key', fetch).sendMail({ from: 'Curios <hello@curios.my>', to: 'nadia@example.com', subject: 'Hi', text: 'plain' });
    await expect(sending).rejects.toThrow('Resend refused the email: 422 validation_error');
    await expect(sending).rejects.not.toThrow(/nadia/);
  });
});

describe('mailTransport', () => {
  const keys = ['NODE_ENV', 'RESEND_API_KEY'] as const;
  let before: Record<string, string | undefined> = {};
  beforeEach(() => {
    before = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  });
  afterEach(() => {
    for (const k of keys) {
      if (before[k] === undefined) delete process.env[k];
      else process.env[k] = before[k];
    }
  });

  it('sends through Resend’s API in production, where the host blocks SMTP', () => {
    process.env.NODE_ENV = 'production';
    process.env.RESEND_API_KEY = 're_key';
    expect(mailTransport().kind).toBe('resend');
  });

  it('keeps SMTP outside production, so a development key never mails a real address', () => {
    process.env.NODE_ENV = 'development';
    process.env.RESEND_API_KEY = 're_key';
    expect(mailTransport().kind).toBe('smtp');
  });
});
