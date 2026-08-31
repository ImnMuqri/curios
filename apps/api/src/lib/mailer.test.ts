import { describe, expect, it } from 'vitest';
import type { MailJobData } from '@curios/core';
import { createQueueMailer } from './mailer.js';

function recordingQueue() {
  const added: Array<{ name: string; data: MailJobData }> = [];
  return {
    added,
    queue: {
      async add(name: string, data: MailJobData) {
        added.push({ name, data });
        return {};
      },
    },
  };
}

describe('createQueueMailer', () => {
  it('hands the message to the queue rather than sending it', async () => {
    const { added, queue } = recordingQueue();

    await createQueueMailer(queue).send({
      to: 'nadia@example.com',
      subject: 'Confirm your email',
      text: 'https://curios.my/verify?token=abc',
    });

    // Nothing here opens a socket. That is the point: the request that
    // triggered this returns without waiting for SMTP, so a slow or unknown
    // address costs the same as a fast known one.
    expect(added).toHaveLength(1);
    expect(added[0]?.data).toEqual({
      to: 'nadia@example.com',
      subject: 'Confirm your email',
      text: 'https://curios.my/verify?token=abc',
    });
  });

  it('surfaces a failure to enqueue rather than swallowing it', async () => {
    const queue = {
      async add() {
        throw new Error('redis down');
      },
    };

    // Enqueuing is fast and local. If even that fails the caller should hear
    // about it, because nothing else will retry what was never queued.
    await expect(
      createQueueMailer(queue).send({ to: 'a@b.c', subject: 's', text: 't' }),
    ).rejects.toThrow('redis down');
  });
});
