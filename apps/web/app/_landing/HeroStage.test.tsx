import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

const kill = vi.fn();
const from = vi.fn((..._args: unknown[]) => ({ kill }));
const to = vi.fn(() => ({ kill: vi.fn(), scrollTrigger: { kill: vi.fn(), progress: 0 } }));

vi.mock('./motion.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('./motion.js')>()), loadMotion: vi.fn(), prefersReducedMotion: vi.fn() }));
const motion = await import('./motion.js');
const { HeroStage } = await import('./HeroStage.js');

const flush = () => new Promise((r) => setTimeout(r, 0));
beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.clearAllMocks());

function stage() {
  vi.mocked(motion.prefersReducedMotion).mockReturnValue(false);
  vi.mocked(motion.loadMotion).mockResolvedValue({ gsap: { from, to } } as unknown as Awaited<ReturnType<typeof motion.loadMotion>>);
  return render(
    <HeroStage askedLabels={['asked 0', 'asked 1']} total={1}>
      <h1><span data-hero-line>Title</span></h1>
      <p data-hero-fade>Sub</p>
      <form data-claim><input /></form>
    </HeroStage>,
  );
}

describe('HeroStage load-in', () => {
  it('fades the headline and the sub, never the claim form, and never by visibility', async () => {
    const { container } = stage();
    await flush();
    const targets = from.mock.calls.map(([nodes]) => [...(nodes as NodeListOf<Element>)]);
    const faded = targets.flat();
    expect(faded).toContain(container.querySelector('[data-hero-line]'));
    expect(faded).toContain(container.querySelector('[data-hero-fade]'));
    expect(faded).not.toContain(container.querySelector('form'));
    for (const [, vars] of from.mock.calls) expect(vars).not.toHaveProperty('autoAlpha');
  });

  it('kills the load-in tweens on unmount', async () => {
    const { unmount } = stage();
    await flush();
    expect(from).toHaveBeenCalledTimes(2);
    expect(kill).not.toHaveBeenCalled();
    unmount();
    expect(kill).toHaveBeenCalledTimes(2);
  });
});
