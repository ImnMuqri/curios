import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Field } from './Field.js';

describe('Field', () => {
  it('binds its label to its input, so clicking the label focuses it', async () => {
    render(<Field id="email" label="Email" value="" onChange={vi.fn()} />);

    await userEvent.click(screen.getByText('Email'));
    expect(screen.getByLabelText('Email')).toHaveFocus();
  });

  it('reports what was typed', async () => {
    const onChange = vi.fn();
    render(<Field id="email" label="Email" value="" onChange={onChange} />);

    await userEvent.type(screen.getByLabelText('Email'), 'n');
    expect(onChange).toHaveBeenCalledWith('n');
  });

  it('passes the input type and autocomplete through', () => {
    // A password field that is not type=password is a password on screen, and
    // a missing autoComplete is a password manager that cannot help.
    render(
      <Field
        id="password"
        label="Password"
        type="password"
        autoComplete="current-password"
        value=""
        onChange={vi.fn()}
      />,
    );

    const input = screen.getByLabelText('Password');
    expect(input).toHaveAttribute('type', 'password');
    expect(input).toHaveAttribute('autocomplete', 'current-password');
  });

  it('renders a textarea when asked, for the one place a human writes prose', () => {
    render(<Field id="claim" label="Claim" multiline value="" onChange={vi.fn()} />);
    expect(screen.getByLabelText('Claim').tagName).toBe('TEXTAREA');
  });

  it('associates a hint with the input rather than leaving it floating', () => {
    // A hint nothing references is invisible to a screen reader, which is the
    // user most likely to need it.
    render(
      <Field
        id="handle"
        label="Handle"
        hint="Letters and numbers only."
        value=""
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Handle')).toHaveAccessibleDescription('Letters and numbers only.');
  });

  // A typo in a password nobody can see is an account nobody can sign in to.
  describe('a password field', () => {
    const renderPassword = (onSubmit = vi.fn((event: Event) => event.preventDefault())) => {
      render(
        <form onSubmit={(event) => onSubmit(event.nativeEvent)}>
          <Field id="password" label="Password" type="password" value="secret" onChange={vi.fn()} />
        </form>,
      );
      return onSubmit;
    };

    it('starts hidden, and shows what was typed on request', async () => {
      renderPassword();
      const input = screen.getByLabelText('Password');
      expect(input).toHaveAttribute('type', 'password');

      await userEvent.click(screen.getByRole('button', { name: 'Show password' }));

      expect(input).toHaveAttribute('type', 'text');
      expect(screen.getByRole('button', { name: 'Hide password' })).toHaveAttribute('aria-pressed', 'true');
    });

    it('hides it again', async () => {
      renderPassword();

      await userEvent.click(screen.getByRole('button', { name: 'Show password' }));
      await userEvent.click(screen.getByRole('button', { name: 'Hide password' }));

      expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
    });

    // Inside a sign-in form, a toggle that submitted would sign in half-typed.
    it('never submits the form it sits in', async () => {
      const onSubmit = renderPassword();

      await userEvent.click(screen.getByRole('button', { name: 'Show password' }));

      expect(onSubmit).not.toHaveBeenCalled();
    });

    // Its accessible name comes from text, not aria-label, so a query for the
    // field by its label still finds exactly one element.
    it('leaves the field findable by its label alone', () => {
      renderPassword();

      expect(screen.getAllByLabelText(/password/i)).toHaveLength(1);
    });
  });

  it('adds no toggle to any other field', () => {
    render(<Field id="email" label="Email" type="email" value="" onChange={vi.fn()} />);

    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders an adornment inside the field wrapper, beside the input', () => {
    render(
      <Field id="email" label="Email" value="" onChange={vi.fn()} adornment={<i data-testid="deco" />} />,
    );

    const input = screen.getByLabelText('Email');
    expect(screen.getByTestId('deco').parentElement).toBe(input.parentElement?.parentElement);
  });
});
