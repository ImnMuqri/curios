import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('./motion.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('./motion.js')>()), loadMotion: vi.fn(), prefersReducedMotion: vi.fn() }));
const motion = await import('./motion.js');
const { SmoothScroll, scrollToSection } = await import('./SmoothScroll.js');

afterEach(() => vi.clearAllMocks());

describe('SmoothScroll', () => {
  // Review Focus 2.
  it('loads nothing when motion is reduced', () => {
    vi.mocked(motion.prefersReducedMotion).mockReturnValue(true);
    render(<SmoothScroll />);
    expect(motion.loadMotion).not.toHaveBeenCalled();
  });

  it('loads the motion libraries when motion is allowed', () => {
    vi.mocked(motion.prefersReducedMotion).mockReturnValue(false);
    vi.mocked(motion.loadMotion).mockReturnValue(new Promise(() => {}));
    render(<SmoothScroll />);
    expect(motion.loadMotion).toHaveBeenCalledTimes(1);
  });
});

describe('scrollToSection', () => {
  // Review Focus 3: with no Lenis running, it scrolls natively to the section.
  it('falls back to scrollIntoView without Lenis', () => {
    const target = document.createElement('section');
    target.id = 'pricing';
    document.body.append(target);
    target.scrollIntoView = vi.fn();
    const spy = vi.spyOn(target, 'scrollIntoView');
    vi.mocked(motion.prefersReducedMotion).mockReturnValue(false);
    scrollToSection('#pricing');
    expect(spy).toHaveBeenCalled();
    target.remove();
  });

  it('does not throw when the target is missing', () => {
    expect(() => scrollToSection('#nowhere')).not.toThrow();
  });
});
