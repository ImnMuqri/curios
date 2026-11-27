import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pictures, type PicturesProps } from './Pictures.js';
import { Widget } from './Widget.js';
import { BentoPage, type BentoPageProps } from './BentoPage.js';
import { pageCopy } from './page-copy.js';

const pics = (n: number) => Array.from({ length: n }, (_, i) => ({ url: `https://cdn.test/links/p/${i}.webp`, width: 1200, height: 800 }));
const c = pageCopy('en');
const words = { types: c.cardTypes, on: c.cardOn, pictures: c.pictures };
const props = (over: Partial<PicturesProps> = {}): PicturesProps => ({ label: 'Cakes', mode: 'CAROUSEL', pictures: pics(3), altText: 'Our cakes', words: c.pictures, interactive: true, ...over });

describe('Pictures', () => {
  it('carousel: lazy sized images, alt with the position, a dot each, previous and next', () => {
    const { container } = render(<Pictures {...props()} />);
    const imgs = Array.from(container.querySelectorAll('img'));
    expect(imgs.map((i) => i.getAttribute('alt'))).toEqual(['Our cakes (1 of 3)', 'Our cakes (2 of 3)', 'Our cakes (3 of 3)']);
    expect(imgs.every((i) => i.getAttribute('loading') === 'lazy' && i.getAttribute('width') === '1200' && i.getAttribute('height') === '800')).toBe(true);
    expect(container.querySelectorAll('[data-pic-dot]')).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Previous picture' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next picture' })).toBeInTheDocument();
  });

  it('grid: three cells, and with more than three the third says +N', () => {
    const { container, rerender } = render(<Pictures {...props({ mode: 'GRID', pictures: pics(3) })} />);
    expect(container.querySelectorAll('img')).toHaveLength(3);
    expect(container.querySelector('[data-pic-more]')).toBeNull();
    rerender(<Pictures {...props({ mode: 'GRID', pictures: pics(6) })} />);
    expect(container.querySelectorAll('img')).toHaveLength(3);
    expect(container.querySelector('[data-pic-more]')?.textContent).toBe('+3');
  });

  it('single picture: Full keeps its own shape, Square is a square', () => {
    const one = [{ url: 'https://cdn.test/a.gif', width: 480, height: 270 }];
    const { container, rerender } = render(<Pictures {...props({ mode: 'FULL', pictures: one })} />);
    expect(container.querySelector('img')?.getAttribute('alt')).toBe('Our cakes');
    expect(container.querySelector('[data-pic-single]')?.getAttribute('data-mode')).toBe('FULL');
    expect((container.querySelector('[data-pic-single]') as HTMLElement).style.aspectRatio).toBe('480 / 270');
    rerender(<Pictures {...props({ mode: 'SQUARE', pictures: one })} />);
    expect((container.querySelector('[data-pic-single]') as HTMLElement).style.aspectRatio).toBe('1 / 1');
  });

  it('opens a viewer: arrows move, Escape closes and focus goes back', () => {
    render(<Pictures {...props()} />);
    const first = screen.getAllByRole('button', { name: /Open picture/ })[0]!;
    first.focus();
    fireEvent.click(first);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('1 of 3')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'ArrowRight' });
    expect(within(dialog).getByText('2 of 3')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'ArrowLeft' });
    expect(within(dialog).getByText('1 of 3')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(first);
  });

  it('the editor preview (not interactive) draws pictures with nothing to press', () => {
    const { container } = render(<Pictures {...props({ interactive: false })} />);
    expect(container.querySelectorAll('img')).toHaveLength(3);
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });

  it('corners follow the button radius and motion respects reduced-motion (CSS)', () => {
    const css = readFileSync(join(import.meta.dirname, 'Pictures.module.css'), 'utf8');
    expect(css).toMatch(/var\(--btn-radius, 16px\)/);
    expect(css).toMatch(/scroll-snap-type:\s*x mandatory/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
  });
});

describe('Widget with pictures', () => {
  it('draws the gallery, no iframe, and the caption unless it is the default name', () => {
    const { container, rerender } = render(<Widget provider="PICTURES" embedRef={null} label="Cakes" url="" pictureMode="GRID" pictures={pics(3)} altText="Cakes" words={words} />);
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.querySelectorAll('img')).toHaveLength(3);
    expect(container.querySelector('[data-widget-label]')?.textContent).toBe('Cakes');
    rerender(<Widget provider="GIF" embedRef={null} label="GIF" url="" pictureMode="FULL" pictures={pics(1)} words={words} />);
    expect(container.querySelector('[data-widget-label]')).toBeNull();
  });
});

describe('BentoPage with pictures', () => {
  const base: BentoPageProps = {
    displayName: 'Iman',
    handle: 'iman',
    bio: null,
    avatarUrl: null,
    style: 'SOFT',
    accentColor: '#2340c8',
    headingFont: 'JAKARTA',
    links: [
      { id: 'a', label: 'Portfolio', url: 'https://iman.dev', size: null },
      { id: 'p', label: 'Cakes', url: '', size: null, kind: 'WIDGET', provider: 'PICTURES', embedRef: null, pictureMode: 'CAROUSEL', altText: 'Cakes', gallery: pics(3) },
    ],
  };
  it('List: the gallery sits among the links and the first link still leads', () => {
    const { container } = render(<BentoPage {...base} />);
    expect(container.querySelectorAll('li[data-widget] img')).toHaveLength(3);
    expect(container.querySelector('li[data-lead]')?.textContent).toBe('Portfolio');
  });
  it('Bento: a gallery is a wide tile that fills', () => {
    const { container } = render(<BentoPage {...base} layout="BENTO" />);
    const li = container.querySelector('li[data-widget]')!;
    expect(li.getAttribute('data-size')).toBe('WIDE');
    expect(li.querySelectorAll('img')).toHaveLength(3);
  });
  it('Bento: a Square GIF is a small tile', () => {
    const gif = { id: 'g', label: 'GIF', url: '', size: null, kind: 'WIDGET' as const, provider: 'GIF' as const, embedRef: null, pictureMode: 'SQUARE' as const, altText: null, gallery: pics(1) };
    const { container } = render(<BentoPage {...base} layout="BENTO" links={[gif, { id: 'a', label: 'Portfolio', url: 'https://iman.dev', size: null }]} />);
    expect(container.querySelector('li[data-widget]')?.getAttribute('data-size')).toBe('SMALL');
  });
});
