import { describe, expect, it, vi } from 'vitest';
import type { PushJobData } from '@curios/core';
import { sendPushJob, type PushDevice, type PushDevices, type PushSender } from './push.worker.js';

const phone: PushDevice = { endpoint: 'https://push.example/phone', p256dh: 'p1', auth: 'a1' };
const laptop: PushDevice = { endpoint: 'https://push.example/laptop', p256dh: 'p2', auth: 'a2' };
const job: PushJobData = { accountId: 'acc1', title: 'New order #15', body: 'Aisha · RM45.50', url: 'https://curios.my/app/orders?order=o1', tag: 'order-15' };

function devicesOf(list: PushDevice[]): PushDevices & { removed: string[] } {
  const removed: string[] = [];
  return {
    removed,
    list: vi.fn(async (_accountId: string, endpoint?: string) => (endpoint ? list.filter((d) => d.endpoint === endpoint) : list)),
    remove: vi.fn(async (endpoint: string) => void removed.push(endpoint)),
  };
}

/** A web-push error as the library throws it: the push service's status on it. */
const gone = (statusCode: number) => Object.assign(new Error('push service refused'), { statusCode });

describe('sendPushJob', () => {
  it('sends the notification to every device of the account, as JSON the service worker reads', async () => {
    const devices = devicesOf([phone, laptop]);
    const sender: PushSender = { send: vi.fn(async () => undefined) };
    await sendPushJob({ devices, sender }, job);
    expect(devices.list).toHaveBeenCalledWith('acc1', undefined);
    expect(sender.send).toHaveBeenCalledTimes(2);
    const [device, payload] = vi.mocked(sender.send).mock.calls[0]!;
    expect(device).toEqual(phone);
    expect(JSON.parse(payload)).toEqual({ title: 'New order #15', body: 'Aisha · RM45.50', url: job.url, tag: 'order-15' });
  });

  it('sends the Settings test to that one device only', async () => {
    const devices = devicesOf([phone, laptop]);
    const sender: PushSender = { send: vi.fn(async () => undefined) };
    await sendPushJob({ devices, sender }, { ...job, endpoint: laptop.endpoint });
    expect(devices.list).toHaveBeenCalledWith('acc1', laptop.endpoint);
    expect(sender.send).toHaveBeenCalledTimes(1);
  });

  // 404 and 410 are the push service saying the address is gone for good: the owner uninstalled,
  // cleared the site or turned notifications off in the phone's settings.
  it('forgets a device whose address is gone, and still reaches the others', async () => {
    const devices = devicesOf([phone, laptop]);
    const sender: PushSender = { send: vi.fn(async (d: PushDevice) => { if (d === phone) throw gone(410); }) };
    await sendPushJob({ devices, sender }, job);
    expect(devices.removed).toEqual([phone.endpoint]);
    expect(sender.send).toHaveBeenCalledTimes(2);
  });

  // A retry resends to every device; the tag makes a second copy replace the first, never stack.
  it('throws for a retry only when no device could be reached for a reason that may pass', async () => {
    const down = devicesOf([phone]);
    await expect(sendPushJob({ devices: down, sender: { send: async () => { throw gone(503); } } }, job)).rejects.toThrow();
    expect(down.removed).toEqual([]);

    const some = devicesOf([phone, laptop]);
    const sender: PushSender = { send: vi.fn(async (d: PushDevice) => { if (d === phone) throw gone(503); }) };
    await expect(sendPushJob({ devices: some, sender }, job)).resolves.toBeUndefined();
  });

  it('does nothing for an account with no devices', async () => {
    const sender: PushSender = { send: vi.fn() };
    await sendPushJob({ devices: devicesOf([]), sender }, job);
    expect(sender.send).not.toHaveBeenCalled();
  });
});
