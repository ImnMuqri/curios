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

  it('is disabled while busy, so a double tap cannot fire twice', async () => {
    // Every screen on this surface already tracks `busy`. The primitive has to
    // express it, or each screen keeps hand-rolling a disabled attribute and
    // one of them eventually forgets.
    const onClick = vi.fn();
    render(
      <Button busy onClick={onClick}>
        Save
      </Button>,
    );

    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
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
