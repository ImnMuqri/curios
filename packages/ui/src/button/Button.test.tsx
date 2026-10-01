import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './Button.js';

describe('Button', () => {
  it('renders its label and calls the handler', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Publish page</Button>);

    await userEvent.click(screen.getByRole('button', { name: 'Publish page' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('blocks its click while busy, so a double tap cannot fire twice', async () => {
    // Every screen on this surface already tracks `busy`. The primitive has to
    // express it, or each screen keeps hand-rolling a disabled attribute and
    // one of them eventually forgets. It is marked `aria-disabled`, not the
    // native `disabled` attribute -- see the focus test below for why.
    const onClick = vi.fn();
    render(
      <Button busy onClick={onClick}>
        Save
      </Button>,
    );

    const button = screen.getByRole('button');
    expect(button).not.toBeDisabled();
    expect(button).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('stays natively disabled while busy when it is a submit button', () => {
    // A submit button has no onClick to drop; the browser refusing to activate
    // a disabled control is what stops a second form post.
    render(<Button type="submit" busy>Save</Button>);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('keeps focus on itself once a click makes it busy', async () => {
    // A real browser blurs the focused element the instant it gets the
    // native `disabled` attribute -- jsdom does not reproduce that quirk, so
    // this test cannot fail against the old, natively-disabled Button; it
    // documents the fix rather than proving the regression. The moment this
    // matters is exactly the one a caller renders: a click sets `busy`, and
    // the button that was just pressed is where a failure needs to be heard.
    function Wrapper() {
      const [busy, setBusy] = useState(false);
      return (
        <Button busy={busy} onClick={() => setBusy(true)}>
          Save
        </Button>
      );
    }
    render(<Wrapper />);
    const button = screen.getByRole('button');
    await userEvent.click(button);
    expect(button).toHaveFocus();
  });

  it('announces that it is busy, not merely that it is disabled', () => {
    // aria-disabled alone says "you cannot press this" and not "because it is
    // working". aria-busy is the difference between a broken button and a slow
    // one, to someone who cannot see it change.
    render(<Button busy>Save</Button>);
    expect(screen.getByRole('button')).toHaveAttribute('aria-busy', 'true');
  });

  it('is disabled when told to be, independently of busy', () => {
    render(<Button disabled>Save</Button>);
    expect(screen.getByRole('button')).toBeDisabled();
    expect(screen.getByRole('button')).not.toHaveAttribute('aria-busy', 'true');
  });

  it('defaults to type=button so it cannot submit a form by accident', () => {
    // The HTML default is "submit", which is the single most common way a
    // secondary control silently posts the form it happens to sit in.
    render(<Button>Cancel</Button>);
    expect(screen.getByRole('button')).toHaveAttribute('type', 'button');
  });

  it('forwards an accessible name when the label alone is ambiguous', () => {
    render(<Button aria-label="Remove halal certified">Remove</Button>);
    expect(screen.getByRole('button', { name: 'Remove halal certified' })).toBeInTheDocument();
  });

  it('can be a submit button when asked', () => {
    render(<Button type="submit">Sign in</Button>);
    expect(screen.getByRole('button')).toHaveAttribute('type', 'submit');
  });

  it('distinguishes its variants in the DOM', () => {
    const { container: primary } = render(<Button>a</Button>);
    const { container: danger } = render(<Button variant="danger">b</Button>);
    expect(primary.firstElementChild?.className).not.toBe(danger.firstElementChild?.className);
  });
});
