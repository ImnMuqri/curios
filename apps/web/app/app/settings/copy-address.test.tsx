import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CopyAddress } from './copy-address.js';

describe('CopyAddress', () => {
  it('copies the whole address, and says so', async () => {
    const copy = vi.fn().mockResolvedValue(undefined);
    render(<CopyAddress url="https://curios.my/nadia" copy={copy} />);

    await userEvent.click(screen.getByRole('button', { name: 'Copy' }));

    expect(copy).toHaveBeenCalledWith('https://curios.my/nadia');
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('says to copy it by hand when the browser refuses the clipboard', async () => {
    render(<CopyAddress url="https://curios.my/nadia" copy={vi.fn().mockRejectedValue(new Error('denied'))} />);

    await userEvent.click(screen.getByRole('button', { name: 'Copy' }));

    expect(screen.getByRole('button', { name: 'Copy it by hand' })).toBeInTheDocument();
  });
});
