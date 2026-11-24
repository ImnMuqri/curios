import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CoverEditor } from './cover-editor.js';

const look = { accentColor: '#b5294e', headingFont: 'FRAUNCES' as const, background: 'PAPER' as const, backgroundColor: null };

const api = () => ({
  look,
  coverLayout: 'TOP' as const,
  onLayout: vi.fn(),
  saveLayout: vi.fn(async () => undefined),
  onCover: vi.fn(),
  chooseStock: vi.fn(async (name: string) => ({ coverKey: `stock/${name}`, coverUrl: `/covers/${name}.webp` })),
  uploadCover: vi.fn(async () => ({ coverKey: 'covers/p1/a.webp', coverUrl: 'https://cdn.example/covers/p1/a.webp' })),
  removeCover: vi.fn(async () => undefined),
});

describe('CoverEditor', () => {
  it('saves a stock cover in one click and shows which one is on', async () => {
    const calls = api();
    const { rerender } = render(<CoverEditor coverKey={null} coverUrl={null} uploadsEnabled {...calls} />);
    expect(screen.getByRole('button', { name: 'No photo' })).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(screen.getByRole('button', { name: 'Flowers' }));
    expect(calls.chooseStock).toHaveBeenCalledWith('bunga');
    expect(calls.onCover).toHaveBeenCalledWith({ coverKey: 'stock/bunga', coverUrl: '/covers/bunga.webp' });

    rerender(<CoverEditor coverKey="stock/bunga" coverUrl="/covers/bunga.webp" uploadsEnabled {...calls} />);
    expect(screen.getByRole('button', { name: 'Flowers' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'No photo' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('offers only the solid choice, the pink flower and upload; the other stock covers are gone', () => {
    render(<CoverEditor coverKey={null} coverUrl={null} uploadsEnabled {...api()} />);
    for (const name of ['Shopfront', 'Coffee', 'Kitchen', 'Tea and flowers', 'Berries']) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
    expect(screen.getByRole('button', { name: 'No photo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Flowers' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload your own' })).toBeInTheDocument();
  });

  it("still shows a page's saved cover that is no longer offered, as its current choice", () => {
    render(<CoverEditor coverKey="stock/teh" coverUrl="/covers/teh.webp" uploadsEnabled {...api()} />);
    expect(screen.getByRole('button', { name: 'Tea and flowers' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Flowers' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('saves the layout at once, the preview first, and puts it back with a message when the save fails', async () => {
    const calls = api();
    render(<CoverEditor coverKey="stock/bunga" coverUrl="/covers/bunga.webp" uploadsEnabled {...calls} />);
    expect(screen.getByRole('radio', { name: 'Top' })).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(screen.getByRole('radio', { name: 'Full page' }));
    expect(calls.onLayout).toHaveBeenCalledWith({ coverLayout: 'FULL' });
    expect(calls.saveLayout).toHaveBeenCalledWith({ coverLayout: 'FULL' });

    calls.saveLayout.mockRejectedValueOnce(new Error('offline'));
    await userEvent.click(screen.getByRole('radio', { name: 'Full page' }));
    expect(await screen.findByText('That did not save. Try again.')).toBeInTheDocument();
    expect(calls.onLayout).toHaveBeenLastCalledWith({ coverLayout: 'TOP' });
  });

  it('removes the cover with None, and offers stock covers even where uploads are off', async () => {
    const calls = api();
    render(<CoverEditor coverKey="stock/teh" coverUrl="/covers/teh.webp" uploadsEnabled={false} {...calls} />);
    const upload = screen.getByRole('button', { name: 'Upload your own' });
    expect(upload).toBeDisabled();
    expect(upload).toHaveAttribute('title', expect.stringMatching(/switched off here/i));

    await userEvent.click(screen.getByRole('button', { name: 'No photo' }));
    expect(calls.removeCover).toHaveBeenCalled();
    expect(calls.onCover).toHaveBeenCalledWith({ coverKey: null, coverUrl: null });
  });

  it('does not save again when the chosen cover is clicked', async () => {
    const calls = api();
    render(<CoverEditor coverKey="stock/kopi" coverUrl="/covers/kopi.webp" uploadsEnabled {...calls} />);
    await userEvent.click(screen.getByRole('button', { name: 'Coffee' }));
    await userEvent.click(screen.getByRole('button', { name: 'Coffee' }));
    expect(calls.chooseStock).not.toHaveBeenCalled();
  });

  it('uploads a chosen file from the upload tile', async () => {
    const calls = api();
    render(<CoverEditor coverKey={null} coverUrl={null} uploadsEnabled {...calls} />);
    await userEvent.upload(screen.getByLabelText('Upload a cover photo'), new File(['x'], 'shop.png', { type: 'image/png' }));
    expect(calls.uploadCover).toHaveBeenCalled();
    expect(calls.onCover).toHaveBeenCalledWith({ coverKey: 'covers/p1/a.webp', coverUrl: 'https://cdn.example/covers/p1/a.webp' });
  });

  it('shows an uploaded cover as the chosen tile', () => {
    render(<CoverEditor coverKey="covers/p1/a.webp" coverUrl="https://cdn.example/covers/p1/a.webp" uploadsEnabled {...api()} />);
    expect(screen.getByRole('button', { name: 'Your own photo' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('deletes an uploaded cover from its own tile, back to No photo', async () => {
    const calls = api();
    render(<CoverEditor coverKey="covers/p1/a.webp" coverUrl="https://cdn.example/covers/p1/a.webp" uploadsEnabled {...calls} />);
    await userEvent.click(screen.getByRole('button', { name: 'Delete your photo' }));
    expect(calls.removeCover).toHaveBeenCalled();
    expect(calls.onCover).toHaveBeenCalledWith({ coverKey: null, coverUrl: null });
  });

  it('offers no delete on a stock cover or with no photo: there is nothing of the owner to delete', () => {
    const { rerender } = render(<CoverEditor coverKey="stock/kopi" coverUrl="/covers/kopi.webp" uploadsEnabled {...api()} />);
    expect(screen.queryByRole('button', { name: 'Delete your photo' })).toBeNull();
    rerender(<CoverEditor coverKey={null} coverUrl={null} uploadsEnabled {...api()} />);
    expect(screen.queryByRole('button', { name: 'Delete your photo' })).toBeNull();
  });

  it('keeps the cover and says why when a save fails', async () => {
    const calls = api();
    calls.chooseStock.mockRejectedValueOnce(new Error(''));
    render(<CoverEditor coverKey={null} coverUrl={null} uploadsEnabled {...calls} />);
    await userEvent.click(screen.getByRole('button', { name: 'Flowers' }));
    expect(await screen.findByText('That did not save. Try again.')).toBeInTheDocument();
    expect(calls.onCover).not.toHaveBeenCalled();
  });

  it('does not undo a newer layout when an older save fails afterwards', async () => {
    const calls = api();
    let failFirst!: () => void;
    calls.saveLayout
      .mockImplementationOnce(() => new Promise((_, reject) => { failFirst = () => reject(new Error('offline')); }))
      .mockResolvedValueOnce(undefined);
    const { rerender } = render(<CoverEditor coverKey="stock/bunga" coverUrl="/covers/bunga.webp" uploadsEnabled {...calls} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Full page' }));
    rerender(<CoverEditor coverKey="stock/bunga" coverUrl="/covers/bunga.webp" uploadsEnabled {...calls} coverLayout="FULL" />);
    await userEvent.click(screen.getByRole('radio', { name: 'Top' }));
    await act(async () => failFirst());
    expect(calls.onLayout.mock.calls.filter(([c]) => c.coverLayout === 'TOP')).toHaveLength(1);
    expect(screen.queryByText('That did not save. Try again.')).toBeNull();
  });
});
