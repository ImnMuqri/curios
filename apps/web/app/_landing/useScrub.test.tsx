import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { useRef } from 'react';

const tween = { kill: vi.fn(), scrollTrigger: { kill: vi.fn() } };
const to = vi.fn((..._args: unknown[]) => tween);

vi.mock('./motion.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('./motion.js')>()), loadMotion: vi.fn(), prefersReducedMotion: vi.fn() }));
const motion = await import('./motion.js');
const { useScrub } = await import('./useScrub.js');

function Scene({ onProgress }: { onProgress?: (p: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useScrub(ref, { scrub: 1, onProgress });
  return <div ref={ref} data-testid="scene" />;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => vi.clearAllMocks());

function allow() {
  vi.mocked(motion.prefersReducedMotion).mockReturnValue(false);
  vi.mocked(motion.loadMotion).mockResolvedValue({ gsap: { to } } as unknown as Awaited<ReturnType<typeof motion.loadMotion>>);
}

describe('useScrub', () => {
  it('does nothing when motion is reduced', async () => {
    vi.mocked(motion.prefersReducedMotion).mockReturnValue(true);
    const { getByTestId } = render(<Scene />);
    await flush();
    expect(motion.loadMotion).not.toHaveBeenCalled();
    expect(getByTestId('scene').dataset.motion).toBeUndefined();
  });

  it('never tweens if unmounted before the libraries arrive', async () => {
    allow();
    const { unmount } = render(<Scene />);
    unmount();
    await flush();
    expect(to).not.toHaveBeenCalled();
  });

  it('kills the tween and its trigger on unmount', async () => {
    allow();
    const { unmount, getByTestId } = render(<Scene />);
    await flush();
    expect(getByTestId('scene').dataset.motion).toBe('on');
    unmount();
    expect(tween.kill).toHaveBeenCalled();
    expect(tween.scrollTrigger.kill).toHaveBeenCalled();
  });

  it('survives re-renders with a new callback, and the latest one gets progress', async () => {
    allow();
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<Scene onProgress={first} />);
    await flush();
    rerender(<Scene onProgress={second} />);
    await flush();
    expect(to).toHaveBeenCalledTimes(1);
    const vars = to.mock.calls[0]![1] as { scrollTrigger: { onUpdate: (self: { progress: number }) => void } };
    vars.scrollTrigger.onUpdate({ progress: 0.5 });
    expect(second).toHaveBeenCalledWith(0.5);
    expect(first).not.toHaveBeenCalled();
  });
});
