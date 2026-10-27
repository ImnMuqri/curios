import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { pageList, Pager } from './pager.js';

describe('pageList', () => {
  it('numbers every page up to seven', () => {
    expect(pageList(1, 1)).toEqual([1]);
    expect(pageList(4, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('keeps the first, the last and the pages around the current one, with a gap for the rest', () => {
    expect(pageList(6, 12)).toEqual([1, null, 5, 6, 7, null, 12]);
  });

  it('shows five in a row near either end, so the list keeps its length', () => {
    expect(pageList(1, 12)).toEqual([1, 2, 3, 4, 5, null, 12]);
    expect(pageList(4, 12)).toEqual([1, 2, 3, 4, 5, null, 12]);
    expect(pageList(9, 12)).toEqual([1, null, 8, 9, 10, 11, 12]);
    expect(pageList(12, 12)).toEqual([1, null, 8, 9, 10, 11, 12]);
  });
});

describe('Pager', () => {
  it('is nothing when there is one page', () => {
    const { container } = render(<Pager page={1} pages={1} href={(n) => `/x?page=${n}`} label="More" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('links each page but the current one, and has no Previous on the first', () => {
    render(<Pager page={1} pages={9} href={(n) => `/x?page=${n}`} label="More" />);
    expect(screen.queryByRole('link', { name: 'Previous' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Next' })).toHaveAttribute('href', '/x?page=2');
    expect(screen.getByRole('link', { name: 'Page 9' })).toHaveAttribute('href', '/x?page=9');
    expect(screen.getByText('1')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('…')).toHaveAttribute('aria-hidden', 'true');
  });
});
