import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Shell } from './Shell.js';

describe('Shell', () => {
  it('renders its children inside a main landmark', () => {
    // A landmark, not a div: it is how anyone navigating by region skips to
    // the content, and app/layout.tsx already used <main>.
    render(
      <Shell>
        <p>inside</p>
      </Shell>,
    );
    expect(screen.getByRole('main')).toHaveTextContent('inside');
  });

  it('renders a heading when given a title', () => {
    render(<Shell title="Review facts">x</Shell>);
    expect(screen.getByRole('heading', { name: 'Review facts' })).toBeInTheDocument();
  });

  it('renders no heading when given none, rather than an empty one', () => {
    render(<Shell>x</Shell>);
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });

  // Fix round 2, Important #3: AppFrame now renders its own `<main>` around
  // Billing, Leads and Questions, each of which renders a Shell of its own --
  // without this, that would be two nested main landmarks.
  it('renders a plain div, not a second main, when told to', () => {
    render(<Shell as="div">x</Shell>);
    expect(screen.queryByRole('main')).not.toBeInTheDocument();
    expect(screen.getByText('x').closest('div')).toBeInTheDocument();
  });
});
