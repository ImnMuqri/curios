import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, createEvent, fireEvent, render, screen, within } from '@testing-library/react';
import { pageEntries } from '@curios/core/bento';
import { LayoutEditor, edgeScroll } from './layout-editor.js';
import type { LinkItem } from './links-editor.js';

const link = (id: string, label: string, url = `https://${id}.example.com`): LinkItem => ({ id, label, url, size: null, kind: 'LINK', provider: null, embedRef: null, embedTitle: null, embedImage: null });
const spotify: LinkItem = { id: 'w', label: 'Mix', url: 'https://open.spotify.com/track/x', size: null, kind: 'WIDGET', provider: 'SPOTIFY', embedRef: 'track/x', embedTitle: null, embedImage: null };
const links = [link('a', 'Portfolio'), link('b', 'WhatsApp'), link('c', 'GitHub')];

const names = () => screen.getAllByRole('listitem').map((li) => li.getAttribute('aria-label'));
const row = (name: string) => screen.getByRole('listitem', { name });
const live = () => screen.getByRole('status');
const ORIGINAL = ['Portfolio', 'Shop', 'WhatsApp', 'GitHub', 'People often ask'];

function show(
  entries = pageEntries(links, { position: 1, size: null }, { position: 4 }),
  onReorder: (ids: string[]) => Promise<void> = vi.fn(async () => undefined),
  faqEmpty = false,
) {
  render(<LayoutEditor entries={entries} onReorder={onReorder} faqEmpty={faqEmpty} />);
  return onReorder as ReturnType<typeof vi.fn>;
}

/** A requestAnimationFrame that runs only when told to, so a frame is a step. */
function frames() {
  const queue = new Map<number, FrameRequestCallback>();
  let next = 1;
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
    queue.set(next, cb);
    return next++;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => void queue.delete(id));
  return {
    pending: () => queue.size,
    step: () => {
      const [id, cb] = [...queue][0]!;
      queue.delete(id);
      act(() => cb(0));
    },
  };
}

/** The transform each row has at the moment a glide is flushed (the layout is forced): what every glide starts from. */
function glides() {
  const seen: Record<string, string> = {};
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      for (const li of this.parentElement?.children ?? []) seen[(li as HTMLElement).dataset.id!] = (li as HTMLElement).style.transform;
      return 0;
    },
  });
  return seen;
}

const rects = () =>
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const at = this.parentElement ? [...this.parentElement.children].indexOf(this) : 0;
    return { top: at * 50, bottom: at * 50 + 50, height: 50, left: 0, right: 300, width: 300, x: 0, y: at * 50, toJSON: () => ({}) };
  });

const reduceMotion = () =>
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({ matches: query.includes('reduce'), media: query, addEventListener: () => undefined, removeEventListener: () => undefined }) as never);

beforeEach(() => {
  // jsdom has no scrolling: a drag held near an edge asks for it every frame.
  vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (HTMLElement.prototype as { offsetHeight?: number }).offsetHeight;
});

describe('LayoutEditor', () => {
  it('lists everything on the page in page order, each with a drag handle', () => {
    show();
    expect(names()).toEqual(ORIGINAL);
    for (const li of screen.getAllByRole('listitem')) expect(li.querySelector('[data-handle]')).not.toBeNull();
  });

  it('says what each piece is', () => {
    show(pageEntries([links[0]!, spotify], { position: 1, size: null }, { position: null }));
    expect(row('Portfolio')).toHaveTextContent('a.example.com');
    expect(row('Mix')).toHaveTextContent('Spotify');
    expect(row('Shop')).toHaveTextContent(/shop button/i);
  });

  it('dims People often ask and says when it shows, while there are no answers', () => {
    show(undefined, undefined, true);
    expect(row('People often ask')).toHaveTextContent('Shows once you answer questions');
    expect(row('People often ask')).toHaveAttribute('data-dim');
  });

  it('moves a row with the keyboard: Space lifts, ArrowDown moves, Space drops, one save', async () => {
    const onReorder = show();
    row('Portfolio').focus();
    fireEvent.keyDown(row('Portfolio'), { key: ' ' });
    fireEvent.keyDown(row('Portfolio'), { key: 'ArrowDown' });
    expect(live()).toHaveTextContent('Moved Portfolio to position 2 of 5');
    expect(onReorder).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.keyDown(row('Portfolio'), { key: ' ' });
    });

    expect(onReorder).toHaveBeenCalledTimes(1);
    expect(onReorder).toHaveBeenCalledWith(['shop', 'a', 'b', 'c', 'faq']);
    expect(names()).toEqual(['Shop', 'Portfolio', 'WhatsApp', 'GitHub', 'People often ask']);
  });

  it('glides the rows that changed place on an arrow move, and not under reduced motion', () => {
    rects();
    const seen = glides();
    show();
    row('Portfolio').focus();
    fireEvent.keyDown(row('Portfolio'), { key: ' ' });
    fireEvent.keyDown(row('Portfolio'), { key: 'ArrowDown' });
    expect(seen['a']).toBe('translate3d(0, -50px, 0)');
    expect(seen['shop']).toBe('translate3d(0, 50px, 0)');
    expect(row('Portfolio').style.transform).toBe('');
    expect(seen['b']).toBe('');
  });

  it('moves instantly with the keyboard under reduced motion', () => {
    reduceMotion();
    rects();
    const seen = glides();
    show();
    row('Portfolio').focus();
    fireEvent.keyDown(row('Portfolio'), { key: ' ' });
    fireEvent.keyDown(row('Portfolio'), { key: 'ArrowDown' });
    expect(names()).toEqual(['Shop', 'Portfolio', 'WhatsApp', 'GitHub', 'People often ask']);
    expect(seen['a']).toBeUndefined();
  });

  it('glides the rows back when a save fails', async () => {
    rects();
    const seen = glides();
    show(
      undefined,
      vi.fn(async () => {
        throw new Error('nope');
      }),
    );
    row('Portfolio').focus();
    fireEvent.keyDown(row('Portfolio'), { key: ' ' });
    fireEvent.keyDown(row('Portfolio'), { key: 'ArrowDown' });
    await act(async () => {
      fireEvent.keyDown(row('Portfolio'), { key: ' ' });
    });
    expect(names()).toEqual(ORIGINAL);
    // Portfolio was seen at slot 1 (50) and is back at slot 0.
    expect(seen['a']).toBe('translate3d(0, 50px, 0)');
  });

  it('keeps focus on the moved row', () => {
    show();
    row('Portfolio').focus();
    fireEvent.keyDown(row('Portfolio'), { key: ' ' });
    fireEvent.keyDown(row('Portfolio'), { key: 'ArrowDown' });
    expect(row('Portfolio')).toHaveFocus();
  });

  it('does not go past either end', () => {
    show();
    row('Portfolio').focus();
    fireEvent.keyDown(row('Portfolio'), { key: ' ' });
    fireEvent.keyDown(row('Portfolio'), { key: 'ArrowUp' });
    expect(names()[0]).toBe('Portfolio');
  });

  it('cancels with Escape: nothing saved, the order is back', () => {
    const onReorder = show();
    row('Portfolio').focus();
    fireEvent.keyDown(row('Portfolio'), { key: ' ' });
    fireEvent.keyDown(row('Portfolio'), { key: 'ArrowDown' });
    fireEvent.keyDown(row('Portfolio'), { key: 'Escape' });
    expect(names()).toEqual(ORIGINAL);
    expect(onReorder).not.toHaveBeenCalled();
  });

  it('does not save when a row is dropped where it was', async () => {
    const onReorder = show();
    row('Portfolio').focus();
    fireEvent.keyDown(row('Portfolio'), { key: ' ' });
    await act(async () => {
      fireEvent.keyDown(row('Portfolio'), { key: ' ' });
    });
    expect(onReorder).not.toHaveBeenCalled();
  });

  it('moves the FAQ like any other row', async () => {
    const onReorder = show();
    row('People often ask').focus();
    fireEvent.keyDown(row('People often ask'), { key: ' ' });
    fireEvent.keyDown(row('People often ask'), { key: 'ArrowUp' });
    fireEvent.keyDown(row('People often ask'), { key: 'ArrowUp' });
    await act(async () => {
      fireEvent.keyDown(row('People often ask'), { key: ' ' });
    });
    expect(onReorder).toHaveBeenCalledWith(['a', 'shop', 'faq', 'b', 'c']);
  });

  it('puts the order back and says so when the save fails', async () => {
    show(
      undefined,
      vi.fn(async () => {
        throw new Error('Your links changed somewhere else.');
      }),
    );
    row('Portfolio').focus();
    fireEvent.keyDown(row('Portfolio'), { key: ' ' });
    fireEvent.keyDown(row('Portfolio'), { key: 'ArrowDown' });
    await act(async () => {
      fireEvent.keyDown(row('Portfolio'), { key: ' ' });
    });

    expect(names()).toEqual(ORIGINAL);
    expect(screen.getByRole('alert')).toHaveTextContent('Your links changed somewhere else.');
  });

  it('drags with a pointer from the handle, and saves once on release', async () => {
    const onReorder = show();
    // jsdom has no layout: each row is 50px tall, by where it sits in the list now.
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const at = this.parentElement ? [...this.parentElement.children].indexOf(this) : 0;
      return { top: at * 50, bottom: at * 50 + 50, height: 50, left: 0, right: 300, width: 300, x: 0, y: at * 50, toJSON: () => ({}) };
    });
    const handle = row('Portfolio').querySelector('[data-handle]')!;
    const pointer = (type: 'pointerDown' | 'pointerMove' | 'pointerUp', clientY: number) => {
      const event = createEvent[type](handle, {});
      Object.defineProperty(event, 'clientY', { value: clientY });
      Object.defineProperty(event, 'pointerId', { value: 1 });
      fireEvent(handle, event);
    };
    pointer('pointerDown', 25);
    pointer('pointerMove', 120); // past the second row's middle, short of the third's
    expect(names()).toEqual(ORIGINAL);
    expect(onReorder).not.toHaveBeenCalled();
    await act(async () => {
      pointer('pointerUp', 120);
    });
    expect(onReorder).toHaveBeenCalledTimes(1);
    expect(onReorder).toHaveBeenCalledWith(['shop', 'a', 'b', 'c', 'faq']);
  });

  describe('a pointer drag', () => {
    const fire = (type: 'pointerDown' | 'pointerMove' | 'pointerUp' | 'lostPointerCapture', clientY = 0, pointerId = 1) => {
      const handle = row('Portfolio').querySelector('[data-handle]')!;
      const event = createEvent[type](handle, {});
      Object.defineProperty(event, 'clientY', { value: clientY });
      Object.defineProperty(event, 'pointerId', { value: pointerId });
      fireEvent(handle, event);
    };

    it('is cancelled, not stuck, when the pointer capture is lost', () => {
      const onReorder = show();
      rects();
      fire('pointerDown', 25);
      fire('pointerMove', 120);
      fire('lostPointerCapture');
      expect(names()).toEqual(ORIGINAL);
      expect(onReorder).not.toHaveBeenCalled();
      // Not frozen: the keyboard lifts again.
      row('Portfolio').focus();
      fireEvent.keyDown(row('Portfolio'), { key: ' ' });
      expect(live()).toHaveTextContent('Picked up Portfolio');
    });

    it('is put back by Escape', () => {
      const onReorder = show();
      rects();
      fire('pointerDown', 25);
      fire('pointerMove', 120);
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(names()).toEqual(ORIGINAL);
      fire('pointerUp', 120);
      expect(onReorder).not.toHaveBeenCalled();
    });

    describe('near the edge of the screen', () => {
      it('works out a speed from how close the pointer is', () => {
        expect(edgeScroll(400, 800)).toBe(0);
        expect(edgeScroll(48, 800)).toBe(0);
        expect(edgeScroll(24, 800)).toBe(-6);
        expect(edgeScroll(-10, 800)).toBe(-12);
        expect(edgeScroll(776, 800)).toBe(6);
        expect(edgeScroll(900, 800)).toBe(12);
      });

      it('scrolls the window while the pointer is held near the bottom, and keeps hit-testing', () => {
        show();
        rects();
        const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined);
        const raf = frames();
        Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
        fire('pointerDown', 25);
        fire('pointerMove', 820);
        raf.step();
        expect(scrollBy).toHaveBeenCalledWith(0, 12);
        // The lifted row went as far down as the list goes, and every other row made room.
        expect(row('Portfolio').style.transform).toBe('translate3d(0, 200px, 0)');
        expect(row('People often ask').style.transform).toBe('translate3d(0, -50px, 0)');
        expect(names()).toEqual(ORIGINAL);
      });

      it('scrolls up near the top, and not at all in the middle', () => {
        show();
        rects();
        const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined);
        const raf = frames();
        Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
        fire('pointerDown', 25);
        raf.step();
        expect(scrollBy).toHaveBeenLastCalledWith(0, -5.75);
        fire('pointerMove', 400);
        scrollBy.mockClear();
        raf.step();
        expect(scrollBy).not.toHaveBeenCalled();
      });

      it('stops on drop, on cancel and on unmount', () => {
        const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined);
        const raf = frames();
        Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
        show();
        rects();
        fire('pointerDown', 25);
        expect(raf.pending()).toBe(1);
        fire('pointerUp', 25);
        expect(raf.pending()).toBe(0);
        fire('pointerDown', 25);
        expect(raf.pending()).toBe(1);
        fire('lostPointerCapture');
        expect(raf.pending()).toBe(0);
        fire('pointerDown', 25);
        expect(raf.pending()).toBe(1);
        cleanup();
        expect(raf.pending()).toBe(0);
        expect(scrollBy).not.toHaveBeenCalled();
      });
    });

    it('ignores the moves of another pointer', () => {
      show();
      rects();
      fire('pointerDown', 25);
      fire('pointerMove', 120, 2);
      expect(names()).toEqual(ORIGINAL);
    });

    it('moves by the middle of a row, not its bottom', () => {
      show();
      rects();
      const raf = frames();
      fire('pointerDown', 25);
      fire('pointerMove', 70); // short of the second row's middle (75)
      raf.step();
      expect(row('Shop').style.transform).toBe('');
      fire('pointerMove', 80); // past it
      raf.step();
      expect(row('Shop').style.transform).toBe('translate3d(0, -50px, 0)');
      expect(row('WhatsApp').style.transform).toBe('');
    });

    it('follows the pointer by a transform while the DOM order stays fixed, and others glide into the gap', () => {
      show();
      rects();
      const raf = frames();
      fire('pointerDown', 25);
      fire('pointerMove', 130);
      raf.step();
      expect(names()).toEqual(ORIGINAL);
      expect(row('Portfolio')).toHaveAttribute('data-following');
      expect(row('Portfolio').style.transform).toBe('translate3d(0, 105px, 0)');
      // Shop and WhatsApp made room by the lifted row's height; the rest stayed.
      expect(row('Shop').style.transform).toBe('translate3d(0, -50px, 0)');
      expect(row('WhatsApp').style.transform).toBe('translate3d(0, -50px, 0)');
      expect(row('GitHub').style.transform).toBe('');
      // Back up: the shifts are shed.
      fire('pointerMove', 30);
      raf.step();
      expect(row('Shop').style.transform).toBe('');
      expect(row('Portfolio').style.transform).toBe('translate3d(0, 5px, 0)');
    });

    it('shifts rows down when a row from below is lifted above them, clamped to the list', () => {
      show();
      rects();
      const raf = frames();
      const handle = row('GitHub').querySelector('[data-handle]')!;
      const event = createEvent.pointerDown(handle, {});
      Object.defineProperty(event, 'clientY', { value: 175 });
      Object.defineProperty(event, 'pointerId', { value: 1 });
      fireEvent(handle, event);
      fire('pointerMove', -300);
      raf.step();
      expect(row('GitHub').style.transform).toBe('translate3d(0, -150px, 0)');
      for (const name of ['Portfolio', 'Shop', 'WhatsApp']) expect(row(name).style.transform).toBe('translate3d(0, 50px, 0)');
      expect(row('People often ask').style.transform).toBe('');
    });

    it('commits the new order once on drop, from the pointer, with the DOM fixed until then', async () => {
      const onReorder = show();
      rects();
      fire('pointerDown', 25);
      fire('pointerMove', 130);
      expect(names()).toEqual(ORIGINAL);
      await act(async () => {
        fire('pointerUp', 130);
      });
      expect(onReorder).toHaveBeenCalledTimes(1);
      expect(onReorder).toHaveBeenCalledWith(['shop', 'b', 'a', 'c', 'faq']);
      expect(names()).toEqual(['Shop', 'WhatsApp', 'Portfolio', 'GitHub', 'People often ask']);
      for (const li of screen.getAllByRole('listitem')) expect(li.style.transform).toBe('');
    });

    it('does not save a drop back in the same slot', async () => {
      const onReorder = show();
      rects();
      fire('pointerDown', 25);
      fire('pointerMove', 60);
      await act(async () => {
        fire('pointerUp', 60);
      });
      expect(onReorder).not.toHaveBeenCalled();
      expect(names()).toEqual(ORIGINAL);
    });

    it('settles the released row into its slot: it starts where it was let go and ends with no transform', async () => {
      show();
      rects();
      const seen = glides();
      fire('pointerDown', 25);
      fire('pointerMove', 130);
      await act(async () => {
        fire('pointerUp', 130);
      });
      // The mock lays rows out by DOM index, so let go at 0 and landed at 100: it starts 100px above its slot.
      expect(seen['a']).toBe('translate3d(0, -100px, 0)');
      expect(row('Portfolio').style.transform).toBe('');
      expect(row('Portfolio').style.transition).toBe('');
    });

    it('writes every translate in the element\'s own pixels under CSS zoom', async () => {
      Object.defineProperty(Element.prototype, 'currentCSSZoom', { configurable: true, get: () => 0.9 });
      try {
        show();
        rects();
        const raf = frames();
        const seen = glides();
        fire('pointerDown', 25);
        fire('pointerMove', 130);
        raf.step();
        // The window pixels the pointer moved (105) and a row's height (50), divided by the zoom.
        expect(row('Portfolio').style.transform).toBe(`translate3d(0, ${105 / 0.9}px, 0)`);
        expect(row('Shop').style.transform).toBe(`translate3d(0, ${-50 / 0.9}px, 0)`);
        await act(async () => {
          fire('pointerUp', 130);
        });
        expect(seen['a']).toBe(`translate3d(0, ${-100 / 0.9}px, 0)`);
      } finally {
        delete (Element.prototype as { currentCSSZoom?: number }).currentCSSZoom;
      }
    });

    it('places the lifted row again when the page scrolls under a still pointer', () => {
      show();
      rects();
      const raf = frames();
      fire('pointerDown', 25);
      fire('pointerMove', 130);
      raf.step();
      expect(row('Shop').style.transform).toBe('translate3d(0, -50px, 0)');
      fire('pointerMove', 30);
      raf.step();
      expect(row('Shop').style.transform).toBe('');
      // No pointer event: a scroll alone marks the frame.
      fireEvent.scroll(window);
      raf.step();
      expect(row('Shop').style.transform).toBe('');
    });

    it('puts the row back on cancel with no save and nothing left shifted', () => {
      const onReorder = show();
      rects();
      const raf = frames();
      fire('pointerDown', 25);
      fire('pointerMove', 130);
      raf.step();
      expect(row('Shop').style.transform).not.toBe('');
      fire('lostPointerCapture');
      expect(onReorder).not.toHaveBeenCalled();
      expect(names()).toEqual(ORIGINAL);
      for (const li of screen.getAllByRole('listitem')) expect(li.style.transform).toBe('');
      expect(row('Portfolio')).not.toHaveAttribute('data-following');
    });

    it('moves the same way under reduced motion, with nothing to glide', async () => {
      reduceMotion();
      const onReorder = show();
      rects();
      const seen = glides();
      fire('pointerDown', 25);
      fire('pointerMove', 130);
      await act(async () => {
        fire('pointerUp', 130);
      });
      expect(onReorder).toHaveBeenCalledWith(['shop', 'b', 'a', 'c', 'faq']);
      expect(seen['a']).toBe('');
      for (const li of screen.getAllByRole('listitem')) expect(li.style.transform).toBe('');
    });
  });

  it('cannot lift another row while a save is pending, and can once it settles', async () => {
    let settle!: () => void;
    const onReorder = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          settle = resolve;
        }),
    );
    show(undefined, onReorder);
    row('Portfolio').focus();
    fireEvent.keyDown(row('Portfolio'), { key: ' ' });
    fireEvent.keyDown(row('Portfolio'), { key: 'ArrowDown' });
    await act(async () => {
      fireEvent.keyDown(row('Portfolio'), { key: ' ' });
    });
    expect(screen.getByRole('list')).toHaveAttribute('aria-busy', 'true');

    row('GitHub').focus();
    fireEvent.keyDown(row('GitHub'), { key: ' ' });
    fireEvent.keyDown(row('GitHub'), { key: 'ArrowUp' });
    await act(async () => {
      fireEvent.keyDown(row('GitHub'), { key: ' ' });
    });
    expect(onReorder).toHaveBeenCalledTimes(1);

    await act(async () => {
      settle();
    });
    expect(screen.getByRole('list')).not.toHaveAttribute('aria-busy');
    fireEvent.keyDown(row('GitHub'), { key: ' ' });
    expect(live()).toHaveTextContent('Picked up GitHub');
  });

  it('follows the entries it is given when they change elsewhere', () => {
    const { rerender } = render(<LayoutEditor entries={pageEntries(links, null, null)} onReorder={vi.fn()} faqEmpty={false} />);
    expect(names()).toEqual(['Portfolio', 'WhatsApp', 'GitHub']);
    rerender(<LayoutEditor entries={pageEntries(links.slice(0, 2), null, null)} onReorder={vi.fn()} faqEmpty={false} />);
    expect(names()).toEqual(['Portfolio', 'WhatsApp']);
    expect(within(screen.getByRole('list')).queryByText('GitHub')).toBeNull();
  });
});

describe('LayoutEditor, List or Bento', () => {
  const playlist: LinkItem = { id: 'p', label: 'Mix', url: 'https://calendly.com/nadia', size: null, kind: 'WIDGET', provider: 'CALENDLY', embedRef: 'nadia', embedTitle: null, embedImage: null };
  const sizeGroup = (name: string) => screen.queryByRole('radiogroup', { name: `Size of ${name}` });

  function showBento(over: Partial<{ layout: 'LIST' | 'BENTO'; onLayout: (l: 'LIST' | 'BENTO') => Promise<void>; onResize: (id: string, size: string) => Promise<void> }> = {}) {
    const onLayout = over.onLayout ?? vi.fn(async () => undefined);
    const onResize = over.onResize ?? vi.fn(async () => undefined);
    render(
      <LayoutEditor
        entries={pageEntries([links[0]!, playlist, links[1]!], { position: 1, size: null }, { position: 4 })}
        onReorder={vi.fn(async () => undefined)}
        faqEmpty={false}
        layout={over.layout ?? 'BENTO'}
        onLayout={onLayout}
        onResize={onResize as never}
      />,
    );
    return { onLayout: onLayout as ReturnType<typeof vi.fn>, onResize: onResize as ReturnType<typeof vi.fn> };
  }

  it('offers List and Bento at the top, the current one chosen', () => {
    showBento({ layout: 'LIST' });
    const group = screen.getByRole('radiogroup', { name: 'How it is laid out' });
    expect(within(group).getByRole('radio', { name: 'List' })).toBeChecked();
    expect(within(group).getByRole('radio', { name: 'Bento' })).not.toBeChecked();
  });

  it('saves the layout when Bento is chosen', async () => {
    const { onLayout } = showBento({ layout: 'LIST' });
    await act(async () => {
      fireEvent.click(screen.getByRole('radio', { name: 'Bento' }));
    });
    expect(onLayout).toHaveBeenCalledWith('BENTO');
  });

  it('shows no size picker in List', () => {
    showBento({ layout: 'LIST' });
    expect(screen.queryAllByRole('radiogroup', { name: /^Size of/ })).toHaveLength(0);
  });

  it('shows a size picker per row in Bento, none for People often ask', () => {
    showBento();
    for (const name of ['Portfolio', 'Mix', 'Shop', 'WhatsApp']) expect(sizeGroup(name)).not.toBeNull();
    expect(sizeGroup('People often ask')).toBeNull();
  });

  it('offers no size below a player\'s minimum', () => {
    showBento();
    const mix = within(sizeGroup('Mix')!).getAllByRole('radio').map((r) => r.textContent);
    expect(mix).toEqual(['Auto', 'Wide', 'Big']);
    const link = within(sizeGroup('Portfolio')!).getAllByRole('radio').map((r) => r.textContent);
    expect(link).toEqual(['Auto', 'Small', 'Wide', 'Tall', 'Big']);
  });

  it('saves a chosen size by the row\'s id, the shop by its own', async () => {
    const { onResize } = showBento();
    await act(async () => {
      fireEvent.click(within(sizeGroup('Portfolio')!).getByRole('radio', { name: 'Big' }));
    });
    expect(onResize).toHaveBeenCalledWith('a', 'BIG');
    await act(async () => {
      fireEvent.click(within(sizeGroup('Shop')!).getByRole('radio', { name: 'Wide' }));
    });
    expect(onResize).toHaveBeenCalledWith('shop', 'WIDE');
  });

  it('shows the error when a size does not save', async () => {
    showBento({ onResize: vi.fn(async () => Promise.reject(new Error('Not saved'))) });
    await act(async () => {
      fireEvent.click(within(sizeGroup('Portfolio')!).getByRole('radio', { name: 'Big' }));
    });
    expect(screen.getByText('Not saved')).toBeInTheDocument();
  });

  it('selects the saved size, Auto when none, and sends null for Auto', async () => {
    const sized: LinkItem = { ...links[0]!, size: 'BIG' };
    const onResize = vi.fn(async () => undefined);
    render(
      <LayoutEditor entries={pageEntries([sized, links[1]!], null, null)} onReorder={vi.fn()} faqEmpty={false} layout="BENTO" onLayout={vi.fn()} onResize={onResize} />,
    );
    expect(within(sizeGroup('Portfolio')!).getByRole('radio', { name: 'Big' })).toBeChecked();
    expect(within(sizeGroup('WhatsApp')!).getByRole('radio', { name: 'Auto' })).toBeChecked();
    await act(async () => {
      fireEvent.click(within(sizeGroup('Portfolio')!).getByRole('radio', { name: 'Auto' }));
    });
    expect(onResize).toHaveBeenCalledWith('a', null);
  });

  it('says when the grid shows a different size from the saved one', () => {
    const small = (id: string, label: string): LinkItem => ({ ...links[0]!, id, label, size: 'SMALL' });
    // A lone Small in the last row is shown Wide.
    render(<LayoutEditor entries={pageEntries([{ ...links[0]!, size: 'WIDE' }, small('z', 'Zed')], null, null)} onReorder={vi.fn()} faqEmpty={false} layout="BENTO" onLayout={vi.fn()} onResize={vi.fn()} />);
    expect(within(sizeGroup('Zed')!).getByRole('radio', { name: 'Small' })).toBeChecked();
    expect(screen.getByText('Shown Wide to fill the grid')).toBeInTheDocument();
  });

  it('ignores a second choice while a save is pending, then works again', async () => {
    let settle!: () => void;
    const onResize = vi.fn(() => new Promise<void>((resolve) => { settle = resolve; }));
    render(<LayoutEditor entries={pageEntries([links[0]!, links[1]!], null, null)} onReorder={vi.fn()} faqEmpty={false} layout="BENTO" onLayout={vi.fn()} onResize={onResize} />);
    await act(async () => {
      fireEvent.click(within(sizeGroup('Portfolio')!).getByRole('radio', { name: 'Big' }));
    });
    expect(screen.getByRole('region', { name: 'Layout' })).toHaveAttribute('aria-busy', 'true');
    await act(async () => {
      fireEvent.click(within(sizeGroup('WhatsApp')!).getByRole('radio', { name: 'Wide' }));
    });
    expect(onResize).toHaveBeenCalledTimes(1);
    await act(async () => {
      settle();
    });
    await act(async () => {
      fireEvent.click(within(sizeGroup('WhatsApp')!).getByRole('radio', { name: 'Wide' }));
    });
    expect(onResize).toHaveBeenCalledTimes(2);
  });

  it('offers no shop picker when the shop button is not drawn', () => {
    render(<LayoutEditor entries={pageEntries(links, { position: 0, size: null }, null)} onReorder={vi.fn()} faqEmpty={false} layout="BENTO" onLayout={vi.fn()} onResize={vi.fn()} shopDrawn={false} />);
    expect(sizeGroup('Shop')).toBeNull();
    expect(sizeGroup('Portfolio')).not.toBeNull();
  });

  it('notes a Wide shown for a row that is Auto or saved Small, when the grid widens it', () => {
    const wide: LinkItem = { ...links[0]!, size: 'WIDE' };
    const auto: LinkItem = { ...links[1]!, id: 'z', label: 'Zed' };
    render(<LayoutEditor entries={pageEntries([wide, { ...wide, id: 'y', label: 'Why' }, auto, { ...wide, id: 'x', label: 'Ex' }], null, null)} onReorder={vi.fn()} faqEmpty={false} layout="BENTO" onLayout={vi.fn()} onResize={vi.fn()} />);
    // Auto (a lone Small by position) is drawn Wide: the saved value stays Auto.
    expect(within(sizeGroup('Zed')!).getByRole('radio', { name: 'Auto' })).toBeChecked();
    expect(screen.getAllByText('Shown Wide to fill the grid').length).toBeGreaterThan(0);
  });
});
