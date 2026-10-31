import { describe, expect, it, vi } from 'vitest';
import type { MailJobData } from '@curios/core';
import { defaultSettings } from '@curios/core/settings';
import { processMailJob, recordFinalFailure, sendMailJob } from './mail.worker.js';

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

  it('never holds back a support email, whatever its audience', async () => {
    const send = vi.fn(async () => undefined);

    await sendMailJob({ send }, { to: 'nadia@example.com', subject: 'Re: help', text: 't', audience: 'owner', from: 'support' }, ownerEmailsOff);

    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe('processMailJob', () => {
  const data = { to: 'nadia@example.com', subject: 'Re: help', text: 't', from: 'support' as const, supportMessageId: 'sm1' };
  const job = (attemptsMade: number, attempts = 5, jobData: MailJobData = data) => ({ data: jobData, attemptsMade, opts: { attempts } });
  const reader = { get: async () => on };
  const failing = {
    send: vi.fn(async () => {
      throw new Error('connection refused');
    }),
  };

  it('marks a support message SENT after it goes out', async () => {
    const onSupportStatus = vi.fn(async () => undefined);

    await processMailJob({ send: async () => undefined }, job(0), reader, { onSupportStatus });

    expect(onSupportStatus.mock.calls).toEqual([['sm1', 'SENT']]);
  });

  it('marks it FAILED on the final attempt, and still throws', async () => {
    const onSupportStatus = vi.fn(async () => undefined);

    // attemptsMade counts the finished attempts, so the fifth try is 4.
    await expect(processMailJob(failing, job(4), reader, { onSupportStatus })).rejects.toThrow('connection refused');

    expect(onSupportStatus.mock.calls).toEqual([['sm1', 'FAILED']]);
  });

  it('writes nothing on a failure the queue will retry', async () => {
    const onSupportStatus = vi.fn(async () => undefined);

    await expect(processMailJob(failing, job(3), reader, { onSupportStatus })).rejects.toThrow('connection refused');

    expect(onSupportStatus).not.toHaveBeenCalled();
  });

  it('writes no status for a job that is not a support message', async () => {
    const onSupportStatus = vi.fn(async () => undefined);

    await processMailJob({ send: async () => undefined }, job(0, 5, { to: 'a@b.c', subject: 's', text: 't' }), reader, { onSupportStatus });

    expect(onSupportStatus).not.toHaveBeenCalled();
  });

  it('does not turn a sent email into a failed job when the status write fails', async () => {
    const send = vi.fn(async () => undefined);
    const onSupportStatus = vi.fn(async () => {
      throw new Error('db down');
    });
    const log = { info: vi.fn(), error: vi.fn() };

    // A throw here would retry the job and send the reply twice.
    await expect(processMailJob({ send }, job(0), reader, { onSupportStatus, log })).resolves.toBeUndefined();

    expect(send).toHaveBeenCalledTimes(1);
    expect(log.error).toHaveBeenCalled();
  });

  it('marks it FAILED when reading the settings throws on the final attempt', async () => {
    const onSupportStatus = vi.fn(async () => undefined);
    const send = vi.fn(async () => undefined);
    const broken = {
      get: async () => {
        throw new Error('db down');
      },
    };

    await expect(processMailJob({ send }, job(4), broken, { onSupportStatus })).rejects.toThrow('db down');

    expect(send).not.toHaveBeenCalled();
    expect(onSupportStatus.mock.calls).toEqual([['sm1', 'FAILED']]);
  });
});

describe('recordFinalFailure', () => {
  const data = { to: 'nadia@example.com', subject: 'Re: help', text: 't', from: 'support' as const, supportMessageId: 'sm1' };

  it('records FAILED once the queue has run out of attempts', async () => {
    const onSupportStatus = vi.fn(async () => undefined);
    // In the failed event attemptsMade already counts the attempt that just failed.
    await recordFinalFailure({ data, attemptsMade: 5, opts: { attempts: 5 } }, onSupportStatus);
    expect(onSupportStatus.mock.calls).toEqual([['sm1', 'FAILED']]);
  });

  it('records FAILED for a job failed for good before its attempts ran out, as a stalled one is', async () => {
    const onSupportStatus = vi.fn(async () => undefined);
    await recordFinalFailure({ data, attemptsMade: 1, opts: { attempts: 5 }, finishedOn: Date.now() }, onSupportStatus);
    expect(onSupportStatus.mock.calls).toEqual([['sm1', 'FAILED']]);
  });

  it('writes nothing for a failure the queue will retry, a job with no support message, or no job', async () => {
    const onSupportStatus = vi.fn(async () => undefined);
    await recordFinalFailure({ data, attemptsMade: 2, opts: { attempts: 5 } }, onSupportStatus);
    await recordFinalFailure({ data: { to: 'a@b.c', subject: 's', text: 't' }, attemptsMade: 5, opts: { attempts: 5 } }, onSupportStatus);
    await recordFinalFailure(undefined, onSupportStatus);
    expect(onSupportStatus).not.toHaveBeenCalled();
  });

  it('logs rather than throws when the write fails', async () => {
    const log = { info: vi.fn(), error: vi.fn() };
    const onSupportStatus = vi.fn(async () => {
      throw new Error('db down');
    });
    await expect(recordFinalFailure({ data, attemptsMade: 5, opts: { attempts: 5 } }, onSupportStatus, log)).resolves.toBeUndefined();
    expect(log.error).toHaveBeenCalled();
  });
});
