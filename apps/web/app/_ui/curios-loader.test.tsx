import { readFileSync } from 'node:fs';
import path from 'node:path';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CuriosLoader } from './curios-loader.js';

const css = readFileSync(path.join(__dirname, 'curios-loader.module.css'), 'utf8');

describe('CuriosLoader', () => {
  it('shows the wordmark and the default label', () => {
    render(<CuriosLoader />);
    expect(screen.getByRole('status')).toHaveTextContent('Getting your page ready');
    expect(screen.getByRole('img', { name: 'curios' })).toBeInTheDocument();
  });

  it('takes a label', () => {
    render(<CuriosLoader label="Signing you in" />);
    expect(screen.getByRole('status')).toHaveTextContent('Signing you in');
  });

  it('renders on the server with no hooks (it can be in the first paint)', () => {
    expect(renderToString(<CuriosLoader />)).toContain('Getting your page ready');
  });

  it('stays invisible for the first 150ms, so a short wait never flashes it', () => {
    const rule = css.match(/\.loader \{[^}]*\}/)![0];
    expect(rule).toMatch(/opacity: 0/);
    expect(rule).toMatch(/animation: loaderIn 200ms ease-out 150ms forwards/);
  });

  it('is 150px by 3px on the calm line with a sky segment', () => {
    expect(css).toMatch(/\.track \{[^}]*width: 150px;[^}]*height: 3px;[^}]*var\(--calm-line\)/s);
    expect(css).toMatch(/\.bar \{[^}]*background: var\(--sky\)/s);
    expect(css).toMatch(/var\(--loader-bg, var\(--calm-bg\)\)/);
    expect(css).toMatch(/\.label \{[^}]*var\(--calm-muted\)[^}]*font-size: 16px/s);
  });

  it('holds the segment still and only breathes under reduced motion', () => {
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toMatch(/animation: loaderBreathe/);
    expect(reduced).not.toMatch(/loaderSlide/);
  });
});
