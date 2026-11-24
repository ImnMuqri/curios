import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { AuthShell, GoogleButton, Or } from './AuthShell.js';
import { AuthPeek } from './AuthPeek.js';
import { PillField } from './PillField.js';

describe('AuthShell, the Site board hero-style auth frame', () => {
  it('is one centred column: the landing nav, a big headline, a line, the form, the small footer, no side panel', () => {
    const { container } = render(
      <AuthShell title="Welcome back." lede="Sign in to see your leads.">
        <p>the form</p>
      </AuthShell>,
    );
    expect(screen.getByRole('navigation', { name: 'Sections' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Welcome back.' })).toBeInTheDocument();
    expect(screen.getByText('Sign in to see your leads.')).toBeInTheDocument();
    expect(screen.getByText('the form')).toBeInTheDocument();
    expect(container.querySelector('aside')).toBeNull();

    const footer = screen.getByRole('contentinfo');
    expect(footer).toHaveTextContent('© Curios');
    expect(within(footer).getAllByRole('link').map((link) => link.textContent)).toEqual(['Terms', 'Privacy', 'Bahasa Melayu']);
  });

  it('puts the chip above the headline, and links the nav sections back to the landing', () => {
    render(<AuthShell title="Create" chip={<p>✓ We’ll fill in curios.my/keklina for you</p>} />);
    const chip = screen.getByText(/fill in curios\.my\/keklina/);
    expect(chip.compareDocumentPosition(screen.getByRole('heading', { level: 1 })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Pricing' })).toHaveAttribute('href', '/#pricing');
  });

  it('leaves the form wrapper out when there is nothing in it', () => {
    const { container } = render(<AuthShell title="Hello" />);
    expect(container.querySelector('[class*="form"]')).toBeNull();
  });
});

describe('GoogleButton and Or', () => {
  it('is an anchor to the API, never a button, under a bare "or"', () => {
    render(
      <>
        <Or />
        <GoogleButton />
      </>,
    );
    expect(screen.getByText('or')).toBeInTheDocument();
    const google = screen.getByRole('link', { name: 'Continue with Google' });
    expect(google.getAttribute('href')).toMatch(/\/auth\/google$/);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('PillField and AuthPeek', () => {
  it('keeps its label for a screen reader, shows the placeholder, and ties a description', () => {
    render(<PillField id="email" label="Email" value="" onChange={() => {}} placeholder="Email" autoComplete="email" describedBy="why" invalid />);
    const input = screen.getByLabelText('Email');
    expect(input).toHaveAttribute('placeholder', 'Email');
    expect(input).toHaveAttribute('autocomplete', 'email');
    expect(input).toHaveAttribute('aria-describedby', 'why');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Email', { selector: 'label' }).className).toMatch(/srOnly/);
  });

  it('draws Peek full body, hidden from assistive tech, with his hands up when shy', () => {
    const { container, rerender } = render(<AuthPeek />);
    const peek = container.querySelector('[data-auth-peek]') as HTMLElement;
    expect(peek).toHaveAttribute('aria-hidden', 'true');
    expect(peek).toHaveAttribute('data-auth-peek', 'follow');
    expect(peek.querySelector('svg')?.getAttribute('class')).not.toMatch(/shy/);

    rerender(<AuthPeek shy />);
    expect(container.querySelector('[data-auth-peek]')).toHaveAttribute('data-auth-peek', 'shy');
    expect(container.querySelector('svg')?.getAttribute('class')).toMatch(/shy/);

    rerender(<AuthPeek wave />);
    expect(container.querySelector('svg')?.getAttribute('class')).toMatch(/wave/);
  });
});
