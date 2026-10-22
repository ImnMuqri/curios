import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { Wordmark } from './Wordmark.js';

describe('Wordmark', () => {
  it('renders curi, the eyes o and s, with "curios" as its accessible name', () => {
    const { container } = render(<Wordmark />);
    const mark = container.firstElementChild as HTMLElement;
    expect(mark.textContent).toBe('curis');
    expect(mark.querySelector('svg')).not.toBeNull();
    expect(mark.getAttribute('role')).toBe('img');
    expect(mark.getAttribute('aria-label')).toBe('curios');
  });

  it('the o carries the ring, eyes and happy arcs', () => {
    const { container } = render(<Wordmark />);
    expect(container.querySelectorAll('circle').length).toBe(3);
    expect(container.querySelector('path')).not.toBeNull();
    expect(container.querySelectorAll('g').length).toBe(2);
  });

  it('takes a ghost tone and children inside the o', () => {
    const { container } = render(
      <Wordmark tone="ghost">
        <i data-testid="peek" />
      </Wordmark>,
    );
    const mo = container.querySelector('svg')!.parentElement!;
    expect(mo.querySelector('[data-testid="peek"]')).not.toBeNull();
    expect(container.firstElementChild!.getAttribute('data-tone')).toBe('ghost');
  });

  it('two wordmarks on one page have no duplicate ids', () => {
    const { container } = render(
      <>
        <Wordmark />
        <Wordmark />
      </>,
    );
    const ids = [...container.querySelectorAll('[id]')].map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
