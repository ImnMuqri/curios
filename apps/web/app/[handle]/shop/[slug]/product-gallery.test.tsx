import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProductGallery } from './product-gallery.js';
import { ProductView } from './product-view.js';
import { shopCopy } from '../copy.js';

const urls = ['https://cdn.test/a.webp', 'https://cdn.test/b.webp', 'https://cdn.test/c.webp'];
const scrollTo = vi.fn();

beforeEach(() => {
  scrollTo.mockClear();
  Element.prototype.scrollTo = scrollTo;
});
afterEach(cleanup);

describe('ProductGallery', () => {
  it('shows three slides, a count and three small photos, and a small photo scrolls to its slide', async () => {
    const { container } = render(<ProductGallery name="Kek" urls={urls} copy={shopCopy('en')} />);
    const track = screen.getByRole('group', { name: 'Photos' });
    expect(track.getAttribute('aria-roledescription')).toBe('carousel');
    expect(track.querySelectorAll('img')).toHaveLength(3);
    expect(screen.getByText('1 / 3')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /^Photo \d of 3$/ })).toHaveLength(3);
    await userEvent.click(screen.getByRole('button', { name: 'Photo 3 of 3' }));
    expect(scrollTo).toHaveBeenCalled();
    Object.defineProperty(track, 'clientWidth', { value: 300, configurable: true });
    track.scrollLeft = 600;
    fireEvent.scroll(track);
    expect(screen.getByText('3 / 3')).toBeTruthy();
    expect(container.querySelector('[aria-current="true"]')).toBeTruthy();
  });

  it('shows no count and no row for one photo', () => {
    render(<ProductGallery name="Kek" urls={[urls[0]!]} copy={shopCopy('en')} />);
    expect(screen.queryByText(/\//)).toBeNull();
    expect(screen.queryByRole('button', { name: /^Photo/ })).toBeNull();
  });

  it('shows the letter when there are no photos', () => {
    render(<ProductGallery name="kek" urls={[]} copy={shopCopy('en')} />);
    expect(screen.getByText('K')).toBeTruthy();
  });

  it('opens a full-screen dialog on a tap and closes it on Escape', async () => {
    render(<ProductGallery name="Kek" urls={urls} copy={shopCopy('en')} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    await userEvent.click(screen.getAllByRole('button', { name: 'Kek' })[0]!);
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(within(screen.getByRole('dialog')).getByText('1 / 3')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes the dialog with the close button', async () => {
    render(<ProductGallery name="Kek" urls={urls} copy={shopCopy('en')} />);
    await userEvent.click(screen.getAllByRole('button', { name: 'Kek' })[0]!);
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes the dialog on a downward swipe of more than 80px, not on a short one', async () => {
    render(<ProductGallery name="Kek" urls={urls} copy={shopCopy('en')} />);
    await userEvent.click(screen.getAllByRole('button', { name: 'Kek' })[0]!);
    const dialog = screen.getByRole('dialog');
    const area = dialog.querySelector('img')!.parentElement!.parentElement!;
    fireEvent.touchStart(area, { touches: [{ clientX: 50, clientY: 100 }] });
    fireEvent.touchEnd(area, { touches: [], changedTouches: [{ clientX: 50, clientY: 150 }] });
    expect(screen.queryByRole('dialog')).toBeTruthy();
    fireEvent.touchStart(area, { touches: [{ clientX: 50, clientY: 100 }] });
    fireEvent.touchEnd(area, { touches: [], changedTouches: [{ clientX: 50, clientY: 200 }] });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('names the small photos in Malay', () => {
    render(<ProductGallery name="Kek" urls={urls} copy={shopCopy('ms')} />);
    expect(screen.getByRole('button', { name: 'Gambar 2 daripada 3' })).toBeTruthy();
  });
});

describe('ProductView photos', () => {
  const item = {
    id: 'i', name: 'Kek', slug: 'kek', category: null, tag: null, description: null, photoKey: 'x.webp',
    photoUrl: 'https://cdn.test/x.webp', priceCents: 1000, options: [],
  };
  const props = { handle: 'h', displayName: 'H', language: 'en', items: [item], halal: false, noticeDays: 1, nextDay: null, pickup: true };

  it('shows the one photo when only photoUrl is given', () => {
    const { container } = render(<ProductView {...props} item={item} />);
    expect(container.querySelectorAll('img')).toHaveLength(1);
    expect(screen.queryByText(/\d \/ \d/)).toBeNull();
  });

  it('shows photoUrls when given', () => {
    render(<ProductView {...props} item={{ ...item, photoUrls: urls }} />);
    expect(screen.getByText('1 / 3')).toBeTruthy();
  });
});
