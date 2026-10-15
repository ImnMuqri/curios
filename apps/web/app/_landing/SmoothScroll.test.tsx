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

describe('SmoothScroll with Lenis running', () => {
  const scrollTo = vi.fn();
  const ctor = vi.fn();
  class FakeLenis {
    constructor(options: unknown) {
      ctor(options);
    }
    on() {}
    raf() {}
    destroy() {}
    scrollTo = scrollTo;
  }
  function allowLenis() {
    vi.mocked(motion.prefersReducedMotion).mockReturnValue(false);
    vi.mocked(motion.loadMotion).mockResolvedValue({
      gsap: { ticker: { add: vi.fn(), remove: vi.fn(), lagSmoothing: vi.fn() } },
      ScrollTrigger: { update: vi.fn() },
      Lenis: FakeLenis,
    } as never);
  }
  const frames = () => new Promise((r) => setTimeout(r, 60));

  afterEach(() => {
    window.location.hash = '';
  });

  // The shop demo's basket list and item sheet scroll on their own.
  it('lets nested scroll areas take the wheel', async () => {
    allowLenis();
    const { unmount } = render(<SmoothScroll />);
    await act(async () => {});
    expect(ctor).toHaveBeenCalledWith(expect.objectContaining({ allowNestedScroll: true }));
    unmount();
  });

  it('scrolls to the #hash once the scenes are on, once', async () => {
    allowLenis();
    const target = document.createElement('section');
    target.id = 'pricing';
    document.body.append(target);
    window.location.hash = '#pricing';
    const { unmount } = render(<SmoothScroll />);
    await act(async () => {});
    expect(scrollTo).not.toHaveBeenCalled();
    await act(frames);
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith(target, expect.objectContaining({ immediate: true }));
    unmount();
    target.remove();
  });

  it('does nothing about the hash when there is none', async () => {
    allowLenis();
    const { unmount } = render(<SmoothScroll />);
    await act(frames);
    expect(scrollTo).not.toHaveBeenCalled();
    unmount();
  });
});

describe('scrollToSection focus', () => {
  // Keyboard users: the link scrolls, then focus follows, so the next Tab starts in the section.
  it('moves focus to the section without scrolling again', () => {
    vi.mocked(motion.prefersReducedMotion).mockReturnValue(false);
    const target = document.createElement('section');
    target.id = 'faq';
    target.tabIndex = -1;
    target.scrollIntoView = vi.fn();
    const focus = vi.spyOn(target, 'focus');
    document.body.append(target);
    scrollToSection('#faq');
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(document.activeElement).toBe(target);
    target.remove();
  });
});
