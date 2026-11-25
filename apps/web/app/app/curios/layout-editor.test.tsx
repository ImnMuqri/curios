import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createEvent, fireEvent, render, screen, within } from '@testing-library/react';
import { pageEntries } from '@curios/core/bento';
import { LayoutEditor } from './layout-editor.js';
import type { LinkItem } from './links-editor.js';

const link = (id: string, label: string, url = `https://${id}.example.com`): LinkItem => ({ id, label, url, size: null, kind: 'LINK', provider: null, embedRef: null });
const spotify: LinkItem = { id: 'w', label: 'Mix', url: 'https://open.spotify.com/track/x', size: null, kind: 'WIDGET', provider: 'SPOTIFY', embedRef: 'track/x' };
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

afterEach(() => {
  vi.restoreAllMocks();
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
    pointer('pointerMove', 120); // over the third row, short of its middle
    expect(names()).toEqual(['Shop', 'WhatsApp', 'Portfolio', 'GitHub', 'People often ask']);
    expect(onReorder).not.toHaveBeenCalled();
    await act(async () => {
      pointer('pointerUp', 120);
    });
    expect(onReorder).toHaveBeenCalledTimes(1);
    expect(onReorder).toHaveBeenCalledWith(['shop', 'b', 'a', 'c', 'faq']);
  });

  describe('a pointer drag', () => {
    const rects = () =>
      vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
        const at = this.parentElement ? [...this.parentElement.children].indexOf(this) : 0;
        return { top: at * 50, bottom: at * 50 + 50, height: 50, left: 0, right: 300, width: 300, x: 0, y: at * 50, toJSON: () => ({}) };
      });
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
      fire('pointerDown', 25);
      fire('pointerMove', 80); // past the second row's middle (75)
      expect(names()).toEqual(['Shop', 'WhatsApp', 'Portfolio', 'GitHub', 'People often ask']);
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
  const playlist: LinkItem = { id: 'p', label: 'Mix', url: 'https://open.spotify.com/playlist/x', size: null, kind: 'WIDGET', provider: 'SPOTIFY', embedRef: 'playlist/x' };
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
