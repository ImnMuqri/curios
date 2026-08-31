import { describe, expect, it } from 'vitest';
import { sendMailJob } from './mail.worker.js';

describe('sendMailJob', () => {
  it('sends the job through the transport it was given', async () => {
    const sent: Array<{ to: string; subject: string; text: string }> = [];
    const mailer = {
      async send(message: { to: string; subject: string; text: string }) {
        sent.push(message);
      },
    };

    await sendMailJob(mailer, {
      to: 'nadia@example.com',
      subject: 'Reset your password',
      text: 'https://curios.my/reset?token=abc',
    });

    expect(sent).toEqual([
      {
        to: 'nadia@example.com',
        subject: 'Reset your password',
        text: 'https://curios.my/reset?token=abc',
      },
    ]);
  });

  it('lets a send failure escape, so the queue retries it', async () => {
    const mailer = {
      async send() {
        throw new Error('connection refused');
      },
    };

    // Swallowing this would mark the job complete and lose the message. Nobody
    // is waiting on the HTTP side any more, so the retry is the only thing that
    // gets a verification link delivered at all.
    await expect(
      sendMailJob(mailer, { to: 'a@b.c', subject: 's', text: 't' }),
    ).rejects.toThrow('connection refused');
  });
});
