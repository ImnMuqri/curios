import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Callout } from './Callout.js';

describe('Callout', () => {
  it('gives an error the alert role, so it interrupts', () => {
    // These screens already render role="alert" for failures and role="status"
    // for progress. The primitive has to keep that distinction, not flatten it.
    render(<Callout tone="error">That password has appeared in a public breach.</Callout>);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('gives info the status role, so it does not', () => {
    render(<Callout tone="info">Reading your website…</Callout>);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('gives an action the status role too', () => {
    render(<Callout tone="action">Two facts still need a decision.</Callout>);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('distinguishes the tones in the DOM', () => {
    const { container: error } = render(<Callout tone="error">a</Callout>);
    const { container: action } = render(<Callout tone="action">b</Callout>);
    expect(error.firstElementChild?.className).not.toBe(action.firstElementChild?.className);
  });

  it('marks an error with a hidden alert icon beside its words, and only an error', () => {
    const { container: error } = render(<Callout tone="error">Could not save.</Callout>);
    expect(error.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent('Could not save.');
    const { container: info } = render(<Callout tone="info">Reading…</Callout>);
    expect(info.querySelector('svg')).toBeNull();
  });

  it('takes a role over the one the tone gives', () => {
    render(<Callout tone="error" role="none">Could not read it.</Callout>);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
