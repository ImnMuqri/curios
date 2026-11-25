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
    pointer('pointerMove', 125); // over the third row
    expect(names()).toEqual(['Shop', 'WhatsApp', 'Portfolio', 'GitHub', 'People often ask']);
    expect(onReorder).not.toHaveBeenCalled();
    await act(async () => {
      pointer('pointerUp', 125);
    });
    expect(onReorder).toHaveBeenCalledTimes(1);
    expect(onReorder).toHaveBeenCalledWith(['shop', 'b', 'a', 'c', 'faq']);
  });

  it('follows the entries it is given when they change elsewhere', () => {
    const { rerender } = render(<LayoutEditor entries={pageEntries(links, null, null)} onReorder={vi.fn()} faqEmpty={false} />);
    expect(names()).toEqual(['Portfolio', 'WhatsApp', 'GitHub']);
    rerender(<LayoutEditor entries={pageEntries(links.slice(0, 2), null, null)} onReorder={vi.fn()} faqEmpty={false} />);
    expect(names()).toEqual(['Portfolio', 'WhatsApp']);
    expect(within(screen.getByRole('list')).queryByText('GitHub')).toBeNull();
  });
});
