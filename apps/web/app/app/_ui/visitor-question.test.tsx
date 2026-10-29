import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LeadCard } from './lead-card.js';
import { VisitorQuestion } from './visitor-question.js';

const css = (file: string) => readFileSync(join(import.meta.dirname, file), 'utf8');

describe('VisitorQuestion', () => {
  const source = () => css('./visitor-question.module.css');

  it('is a card bubble on a hairline inside the dashboard, 10px corners', () => {
    render(<VisitorQuestion>Do you deliver to Klang?</VisitorQuestion>);
    const bubble = screen.getByText('Do you deliver to Klang?');
    expect(bubble.className).toMatch(/question/);
    expect(bubble).not.toHaveAttribute('data-on-page');
    const body = /\.question\s*\{([^}]*)\}/.exec(source())?.[1] ?? '';
    expect(body).toMatch(/border-radius:\s*10px/);
    expect(body).toMatch(/background:\s*var\(--card\)/);
    expect(body).toMatch(/box-shadow:\s*0 0 0 1px var\(--line\)/);
  });

  it('is the public chat’s translucent bubble on the owner’s page: the panel’s own text at 14%, 16px corners', () => {
    render(<VisitorQuestion onPage>Do you deliver to Klang?</VisitorQuestion>);
    expect(screen.getByText('Do you deliver to Klang?')).toHaveAttribute('data-on-page', 'true');
    const body = /\.question\[data-on-page\]\s*\{([^}]*)\}/.exec(source())?.[1] ?? '';
    expect(body).toMatch(/border-radius:\s*16px/);
    expect(body).toMatch(/background:\s*color-mix\(in srgb, currentColor 14%, transparent\)/);
  });
});

describe('LeadCard', () => {
  it('reads "{First name} can answer this one" with a number field and Send', () => {
    render(<LeadCard name="Nadia Bakes" />);
    expect(screen.getByText('Nadia can answer this one')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('012-345 6789')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
  });

  it('is a picture: the field cannot be typed in and Send is not a way out', () => {
    render(<LeadCard name="Lina" />);
    expect(screen.getByPlaceholderText('012-345 6789')).toHaveAttribute('readonly');
    expect(screen.getByRole('button', { name: 'Send' })).toHaveAttribute('aria-disabled', 'true');
  });
});
