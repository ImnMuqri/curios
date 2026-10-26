import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { onShutdown } from './shutdown.js';

const log = { info: vi.fn(), error: vi.fn() };

function setUp(close: () => Promise<unknown>, graceMs = 1_000) {
  const signals = new EventEmitter();
  const exit = vi.fn();
  onShutdown(close, log, { graceMs, signals: signals as unknown as Pick<NodeJS.Process, 'once'>, exit });
  return { signals, exit };
}

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('onShutdown', () => {
  it('closes once on SIGTERM and exits 0', async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const { signals, exit } = setUp(close);
    signals.emit('SIGTERM');
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('closes once when SIGINT follows SIGTERM', async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const { signals, exit } = setUp(close);
    signals.emit('SIGTERM');
    signals.emit('SIGINT');
    await vi.waitFor(() => expect(exit).toHaveBeenCalled());
    expect(close).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it('exits 1 when closing throws', async () => {
    const { signals, exit } = setUp(() => Promise.reject(new Error('redis gone')));
    signals.emit('SIGINT');
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
    expect(log.error).toHaveBeenCalledWith({ err: 'redis gone' }, 'shutdown failed');
  });

  it('exits 1 at the grace when closing hangs', () => {
    vi.useFakeTimers();
    const { signals, exit } = setUp(() => new Promise(() => {}), 500);
    signals.emit('SIGTERM');
    vi.advanceTimersByTime(499);
    expect(exit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(exit).toHaveBeenCalledWith(1);
  });
});
