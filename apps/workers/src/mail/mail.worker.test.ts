import { describe, expect, it, vi } from 'vitest';
import { defaultSettings } from '@curios/core/settings';
import { sendMailJob } from './mail.worker.js';

const on = defaultSettings();
const ownerEmailsOff = defaultSettings();
ownerEmailsOff.switches.ownerEmails = false;

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
    }, on);

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
      sendMailJob(mailer, { to: 'a@b.c', subject: 's', text: 't' }, on),
    ).rejects.toThrow('connection refused');
  });

  it('drops an owner email while emails to owners are off, completing the job and logging it', async () => {
    const send = vi.fn(async () => undefined);
    const log = { info: vi.fn() };

    await expect(
      sendMailJob({ send }, { to: 'nadia@example.com', subject: 'New order #12', text: 't', audience: 'owner' }, ownerEmailsOff, log),
    ).resolves.toBeUndefined();

    expect(send).not.toHaveBeenCalled();
    expect(log.info).toHaveBeenCalledWith({ subject: 'New order #12' }, 'owner email held back by switch');
  });

  it('still sends a password reset, and every untagged email, while emails to owners are off', async () => {
    const send = vi.fn(async () => undefined);

    await sendMailJob({ send }, { to: 'nadia@example.com', subject: 'Reset your password', text: 't' }, ownerEmailsOff);

    expect(send).toHaveBeenCalledTimes(1);
  });

  it('sends an owner email again once the switch is back on', async () => {
    const send = vi.fn(async () => undefined);

    await sendMailJob({ send }, { to: 'nadia@example.com', subject: 'New order #12', text: 't', audience: 'owner' }, on);

    expect(send).toHaveBeenCalledWith({ to: 'nadia@example.com', subject: 'New order #12', text: 't', audience: 'owner' });
  });
});
