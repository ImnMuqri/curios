import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';

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

describe('scrollToSection with Lenis running', () => {
  // Lenis ignores CSS scroll-padding, so the call must clear the sticky bar itself.
  it('scrolls to a negative offset of the header height', async () => {
    const scrollTo = vi.fn();
    class FakeLenis {
      on() {}
      raf() {}
      destroy() {}
      scrollTo = scrollTo;
    }
    vi.mocked(motion.prefersReducedMotion).mockReturnValue(false);
    vi.mocked(motion.loadMotion).mockResolvedValue({
      gsap: { ticker: { add: vi.fn(), remove: vi.fn(), lagSmoothing: vi.fn() } },
      ScrollTrigger: { update: vi.fn() },
      Lenis: FakeLenis,
    } as never);
    document.documentElement.style.setProperty('--l-header-h', '70px');
    const target = document.createElement('section');
    target.id = 'pricing';
    document.body.append(target);
    const { unmount } = render(<SmoothScroll />);
    await act(async () => {});
    scrollToSection('#pricing');
    expect(scrollTo).toHaveBeenCalledWith(target, expect.objectContaining({ offset: -70 }));
    unmount();
    target.remove();
    document.documentElement.style.removeProperty('--l-header-h');
  });
});
