import { describe, expect, it } from 'vitest';
import { createMailer } from './mailer.js';

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

describe('createMailer', () => {
  it('sends the message with the configured sender', async () => {
    process.env.MAIL_FROM = 'Curios <hello@curios.my>';
    const { sent, transport } = recordingTransport();

    await createMailer(transport).send({
      to: 'nadia@example.com',
      subject: 'Confirm your email',
      text: 'https://curios.my/verify?token=abc',
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      from: 'Curios <hello@curios.my>',
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
