import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Thinking } from './Thinking.js';

describe('Thinking', () => {
  it('is the word, with the o hidden from screen readers', () => {
    const { container } = render(<Thinking />);
    expect(container).toHaveTextContent(/^Inquiring…$/);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('says the word it is given', () => {
    const { container } = render(<Thinking label="Sedang menyemak" />);
    expect(container).toHaveTextContent(/^Sedang menyemak…$/);
  });

  it('holds still for a visitor who asked for less motion', () => {
    const css = readFileSync(join(import.meta.dirname, 'Thinking.module.css'), 'utf8');
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.mo,\s*\.eyes \{\s*animation: none;/);
  });
});
