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
    await userEvent.click(screen.getAllByRole('button', { name: /^Kek/ })[0]!);
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(within(screen.getByRole('dialog')).getByText('1 / 3')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes the dialog with the close button', async () => {
    render(<ProductGallery name="Kek" urls={urls} copy={shopCopy('en')} />);
    await userEvent.click(screen.getAllByRole('button', { name: /^Kek/ })[0]!);
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes the dialog on a downward swipe of more than 80px, not on a short one', async () => {
    render(<ProductGallery name="Kek" urls={urls} copy={shopCopy('en')} />);
    await userEvent.click(screen.getAllByRole('button', { name: /^Kek/ })[0]!);
    const dialog = screen.getByRole('dialog');
    const area = dialog.querySelector('img')!.parentElement!.parentElement!;
    fireEvent.touchStart(area, { touches: [{ clientX: 50, clientY: 100 }] });
    fireEvent.touchEnd(area, { touches: [], changedTouches: [{ clientX: 50, clientY: 150 }] });
    expect(screen.queryByRole('dialog')).toBeTruthy();
    fireEvent.touchStart(area, { touches: [{ clientX: 50, clientY: 100 }] });
    fireEvent.touchEnd(area, { touches: [], changedTouches: [{ clientX: 50, clientY: 200 }] });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('labels slides "name, Photo i of n", makes only the current one tabbable and lazy-loads the rest', () => {
    render(<ProductGallery name="Kek" urls={urls} copy={shopCopy('en')} />);
    const slides = screen.getAllByRole('button', { name: /^Kek, Photo \d of 3$/ });
    expect(slides.map((b) => b.getAttribute('aria-label'))).toEqual(['Kek, Photo 1 of 3', 'Kek, Photo 2 of 3', 'Kek, Photo 3 of 3']);
    expect(slides.map((b) => b.tabIndex)).toEqual([0, -1, -1]);
    expect(slides.map((b) => b.querySelector('img')?.getAttribute('loading'))).toEqual(['eager', 'lazy', 'lazy']);
    for (const thumb of screen.getAllByRole('button', { name: /^Photo \d of 3$/ })) expect(thumb.querySelector('img')?.getAttribute('loading')).toBe('lazy');
  });

  it('renders the dialog under document.body and keeps Tab inside it', async () => {
    const { container } = render(<ProductGallery name="Kek" urls={urls} copy={shopCopy('en')} />);
    await userEvent.click(screen.getAllByRole('button', { name: /^Kek/ })[0]!);
    const dialog = screen.getByRole('dialog');
    expect(dialog.parentElement).toBe(document.body);
    expect(container.contains(dialog)).toBe(false);
    expect(dialog.contains(document.activeElement)).toBe(true);
    await userEvent.tab();
    expect(dialog.contains(document.activeElement)).toBe(true);
    await userEvent.tab({ shift: true });
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('pans a zoomed photo with one finger, not past its edge', async () => {
    window.innerWidth = 400;
    window.innerHeight = 800;
    render(<ProductGallery name="Kek" urls={urls} copy={shopCopy('en')} />);
    await userEvent.click(screen.getAllByRole('button', { name: /^Kek/ })[0]!);
    const img = screen.getByRole('dialog').querySelector('img')!;
    const area = img.parentElement!.parentElement!;
    fireEvent.touchStart(area, { touches: [{ clientX: 0, clientY: 0 }, { clientX: 100, clientY: 0 }] });
    fireEvent.touchMove(area, { touches: [{ clientX: 0, clientY: 0 }, { clientX: 200, clientY: 0 }] });
    expect(img.style.transform).toContain('scale(2)');
    fireEvent.touchEnd(area, { touches: [{ clientX: 0, clientY: 0 }], changedTouches: [{ clientX: 200, clientY: 0 }] });
    fireEvent.touchStart(area, { touches: [{ clientX: 100, clientY: 100 }] });
    fireEvent.touchMove(area, { touches: [{ clientX: 130, clientY: 100 }] });
    expect(img.style.transform).toContain('translate(30px, 0px)');
    fireEvent.touchMove(area, { touches: [{ clientX: 900, clientY: 100 }] });
    expect(img.style.transform).toContain('translate(200px, 0px)');
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

  it('shows photoUrl when photoUrls is empty', () => {
    const { container } = render(<ProductView {...props} item={{ ...item, photoUrls: [] }} />);
    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://cdn.test/x.webp');
  });

  it('shows photoUrls when given', () => {
    render(<ProductView {...props} item={{ ...item, photoUrls: urls }} />);
    expect(screen.getByText('1 / 3')).toBeTruthy();
  });
});
