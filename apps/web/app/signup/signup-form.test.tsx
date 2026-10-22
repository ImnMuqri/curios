import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SignUpForm } from './signup-form.js';

describe('SignUpForm', () => {
  it('offers Google first, then the email form', () => {
    render(<SignUpForm onSubmit={vi.fn()} wantedHandle="" />);
    const google = screen.getByRole('link', { name: 'Continue with Google' });
    const email = screen.getByLabelText('Email');
    expect(google.compareDocumentPosition(email) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(email).toHaveAttribute('placeholder', 'you@example.com');
  });

  it('says that creating a page agrees to the Terms and Privacy Policy, and links both', () => {
    render(<SignUpForm onSubmit={vi.fn()} wantedHandle="" />);
    expect(screen.getByText(/By creating a page you agree to the/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Terms' })).toHaveAttribute('href', '/terms');
    expect(screen.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/privacy');
  });

  it('says the address typed on the landing page will be filled in, and nothing when there is none', () => {
    const { unmount } = render(<SignUpForm onSubmit={vi.fn()} wantedHandle="aisyahdraws" />);
    expect(screen.getByText(/fill in curios\.my\/aisyahdraws/)).toBeInTheDocument();
    expect(screen.getByText(/claim curios\.my\/aisyahdraws\./)).toBeInTheDocument();
    unmount();

    render(<SignUpForm onSubmit={vi.fn()} wantedHandle="" />);
    expect(screen.queryByText(/fill in curios\.my\//)).toBeNull();
    expect(screen.getByText(/claim curios\.my\/yourname\./)).toBeInTheDocument();
  });

  it('reads the wanted address from browser storage when not given one', async () => {
    window.localStorage.setItem('curios:wanted-handle', 'keklina');
    render(<SignUpForm onSubmit={vi.fn()} />);
    expect(await screen.findByText(/fill in curios\.my\/keklina/)).toBeInTheDocument();
    window.localStorage.removeItem('curios:wanted-handle');
  });

  it('shows where the email went, and goes back to the form for a wrong address', async () => {
    const onSubmit = vi.fn(async () => undefined);
    render(<SignUpForm onSubmit={onSubmit} wantedHandle="" />);

    await userEvent.type(screen.getByLabelText('Email'), 'lina@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'a-long-enough-passphrase');
    await userEvent.click(screen.getByRole('button', { name: 'Create my page' }));

    expect(screen.getByRole('heading', { name: 'Check your email' })).toBeInTheDocument();
    expect(screen.getByText('lina@example.com')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('link', { name: 'Go back' }));
    expect(screen.getByRole('heading', { name: 'Create your free page' })).toBeInTheDocument();
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
