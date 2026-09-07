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
});
