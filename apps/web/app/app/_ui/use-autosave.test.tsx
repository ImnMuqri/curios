import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useAutosave } from './use-autosave.js';

describe('useAutosave', () => {
  it('saves once, after typing stops, and says so', async () => {
    vi.useFakeTimers();
    const save = vi.fn(async () => undefined);
    const { result } = renderHook(() => useAutosave(save, 600));

    act(() => { result.current.schedule('I'); result.current.schedule('Im'); result.current.schedule('Iman'); });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });

    expect(save).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledWith('Iman');
    expect(result.current.status).toBe('saved');
    vi.useRealTimers();
  });

  it('reports a failure and retries the same value', async () => {
    vi.useFakeTimers();
    const save = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useAutosave(save, 600));

    act(() => result.current.schedule('Iman'));
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(result.current.status).toBe('error');

    await act(async () => { result.current.retry(); await vi.runAllTimersAsync(); });
    expect(save).toHaveBeenLastCalledWith('Iman');
    expect(result.current.status).toBe('saved');
    vi.useRealTimers();
  });

  // A retry that re-debounces (schedule() instead of flush()) still passes
  // the test above, because runAllTimersAsync happily fires the timer it
  // re-created. Advancing by exactly 0ms tells the two apart: flushing sends
  // the request on this tick; scheduling waits out a whole new SAVE_DEBOUNCE_MS.
  it('retry sends the request right away, not after another debounce wait', async () => {
    vi.useFakeTimers();
    const save = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useAutosave(save, 600));

    act(() => result.current.schedule('Iman'));
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(result.current.status).toBe('error');

    await act(async () => {
      result.current.retry();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(save).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe('saved');
    vi.useRealTimers();
  });

  it('flushPending sends a waiting save at once, and only once', async () => {
    vi.useFakeTimers();
    const save = vi.fn(async () => undefined);
    const { result } = renderHook(() => useAutosave(save, 600));

    act(() => result.current.schedule('Kek'));
    await act(async () => { await result.current.flushPending(); });
    expect(save).toHaveBeenCalledWith('Kek');

    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(save).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('flushPending sends nothing when nothing is waiting', async () => {
    vi.useFakeTimers();
    const save = vi.fn(async () => undefined);
    const { result } = renderHook(() => useAutosave(save, 600));

    act(() => result.current.schedule('Kek'));
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    await act(async () => { await result.current.flushPending(); });
    expect(save).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
