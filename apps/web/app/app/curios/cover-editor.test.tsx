import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CoverEditor } from './cover-editor.js';

const api = () => ({
  onCover: vi.fn(),
  chooseStock: vi.fn(async (name: string) => ({ coverKey: `stock/${name}`, coverUrl: `/covers/${name}.webp` })),
  uploadCover: vi.fn(async () => ({ coverKey: 'covers/p1/a.webp', coverUrl: 'https://cdn.example/covers/p1/a.webp' })),
  removeCover: vi.fn(async () => undefined),
});

describe('CoverEditor', () => {
  it('saves a stock cover in one click and shows which one is on', async () => {
    const calls = api();
    const { rerender } = render(<CoverEditor coverKey={null} coverUrl={null} uploadsEnabled {...calls} />);
    expect(screen.getByRole('button', { name: 'None' })).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(screen.getByRole('button', { name: 'Coffee' }));
    expect(calls.chooseStock).toHaveBeenCalledWith('kopi');
    expect(calls.onCover).toHaveBeenCalledWith({ coverKey: 'stock/kopi', coverUrl: '/covers/kopi.webp' });

    rerender(<CoverEditor coverKey="stock/kopi" coverUrl="/covers/kopi.webp" uploadsEnabled {...calls} />);
    expect(screen.getByRole('button', { name: 'Coffee' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'None' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('removes the cover with None, and offers stock covers even where uploads are off', async () => {
    const calls = api();
    render(<CoverEditor coverKey="stock/teh" coverUrl="/covers/teh.webp" uploadsEnabled={false} {...calls} />);
    expect(screen.getByRole('button', { name: /upload your own/i })).toBeDisabled();
    expect(screen.getByText(/switched off here/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'None' }));
    expect(calls.removeCover).toHaveBeenCalled();
    expect(calls.onCover).toHaveBeenCalledWith({ coverKey: null, coverUrl: null });
  });

  it('shows an uploaded cover as the chosen tile', () => {
    render(<CoverEditor coverKey="covers/p1/a.webp" coverUrl="https://cdn.example/covers/p1/a.webp" uploadsEnabled {...api()} />);
    expect(screen.getByRole('button', { name: 'Your own photo' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('keeps the cover and says why when a save fails', async () => {
    const calls = api();
    calls.chooseStock.mockRejectedValueOnce(new Error(''));
    render(<CoverEditor coverKey={null} coverUrl={null} uploadsEnabled {...calls} />);
    await userEvent.click(screen.getByRole('button', { name: 'Flowers' }));
    expect(await screen.findByText('That did not save. Try again.')).toBeInTheDocument();
    expect(calls.onCover).not.toHaveBeenCalled();
  });
});
