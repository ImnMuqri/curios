import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SignUpForm } from './signup-form.js';

describe('SignUpForm', () => {
  it('offers the email form first, then "or", then Google, with the board words', () => {
    render(<SignUpForm onSubmit={vi.fn()} wantedHandle="" />);
    const google = screen.getByRole('link', { name: 'Continue with Google' });
    const email = screen.getByLabelText('Email');
    const password = screen.getByLabelText('Password');
    expect(email.compareDocumentPosition(google) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText('or').compareDocumentPosition(google) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(email).toHaveAttribute('placeholder', 'Email');
    expect(email).toHaveAttribute('autocomplete', 'email');
    expect(password).toHaveAttribute('placeholder', 'Password, 8 characters or more');
    expect(password).toHaveAttribute('autocomplete', 'new-password');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Create your free page.');
    expect(screen.getByText('free').tagName).toBe('SPAN');
  });

  it('says that creating a page agrees to the Terms and Privacy Policy, and links both', () => {
    render(<SignUpForm onSubmit={vi.fn()} wantedHandle="" />);
    const line = screen.getByText(/By creating a page you agree to our/);
    expect(within(line).getByRole('link', { name: 'Terms' })).toHaveAttribute('href', '/terms');
    expect(within(line).getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/privacy');
  });

  it('says the address typed on the landing page will be filled in, and nothing when there is none', () => {
    const { unmount } = render(<SignUpForm onSubmit={vi.fn()} wantedHandle="aisyahdraws" />);
    // The chip sits above the headline.
    const chip = screen.getByText(/fill in curios\.my\/aisyahdraws for you/);
    expect(chip.compareDocumentPosition(screen.getByRole('heading', { level: 1 })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    unmount();

    render(<SignUpForm onSubmit={vi.fn()} wantedHandle="" />);
    expect(screen.queryByText(/fill in curios\.my\//)).toBeNull();
  });

  it('reads the wanted address from browser storage when not given one', async () => {
    window.localStorage.setItem('curios:wanted-handle', 'keklina');
    render(<SignUpForm onSubmit={vi.fn()} />);
    expect(await screen.findByText(/fill in curios\.my\/keklina/)).toBeInTheDocument();
    window.localStorage.removeItem('curios:wanted-handle');
  });

  it('has no "Already have a page?" line on a wide screen: Sign in sits in the nav (a phone-only line backs it up)', () => {
    render(<SignUpForm onSubmit={vi.fn()} wantedHandle="" />);
    expect(screen.getAllByRole('link', { name: 'Sign in' })[0]).toHaveAttribute('href', '/signin');
    expect(screen.getByText(/Already have a page\?/).className).toMatch(/phoneOnly/);
  });

  it('shows where the email went, and goes back to the form for a wrong address', async () => {
    const onSubmit = vi.fn(async () => undefined);
    render(<SignUpForm onSubmit={onSubmit} wantedHandle="" />);

    await userEvent.type(screen.getByLabelText('Email'), 'lina@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'a-long-enough-passphrase');
    await userEvent.click(screen.getByRole('button', { name: 'Create my page' }));

    expect(screen.getByRole('heading', { name: 'Check your email.' })).toBeInTheDocument();
    expect(screen.getByText('lina@example.com')).toBeInTheDocument();
    expect(screen.getByText(/Sent to/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('link', { name: 'Start again' }));
    expect(screen.getByRole('heading', { name: 'Create your free page.' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveValue('lina@example.com');
  });

  it('shows the API message verbatim when sign-up fails', async () => {
    const onSubmit = vi.fn(async () => {
      throw new Error('That password is too short.');
    });
    render(<SignUpForm onSubmit={onSubmit} wantedHandle="" />);
    await userEvent.type(screen.getByLabelText('Email'), 'lina@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'short');
    await userEvent.click(screen.getByRole('button', { name: 'Create my page' }));
    expect(await screen.findByText('That password is too short.')).toBeInTheDocument();
  });
});
