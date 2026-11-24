import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../../lib/api.js';
import { ReportForm } from './report-form.js';

describe('ReportForm', () => {
  it('holds Send until a reason is chosen', async () => {
    const onSubmit = vi.fn().mockResolvedValue(null);
    render(<ReportForm handle="nadia" displayName="Nadia Bakes" language="en" onSubmit={onSubmit} />);

    expect(screen.getByRole('heading', { name: 'Report Nadia Bakes' })).toBeInTheDocument();
    expect(screen.getByText("Tell the Curios team what's wrong. The owner isn't told who reported it.")).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(5);
    // Nothing is chosen to begin with (the board's pre-picked reason is sample state).
    for (const radio of screen.getAllByRole('radio')) expect(radio).not.toBeChecked();
    expect(screen.getByLabelText('More details (optional)')).toHaveAttribute('placeholder', 'What did you see?');
    expect(screen.getByRole('button', { name: 'Send report' })).toBeDisabled();
    // "Back to {name}" waits in the nav too.
    expect(screen.getByRole('link', { name: 'Back to Nadia Bakes' })).toHaveAttribute('href', '/nadia');

    await userEvent.click(screen.getByRole('radio', { name: 'Looks like a scam' }));
    expect(screen.getByRole('button', { name: 'Send report' })).toBeEnabled();
  });

  it('posts the reason and the details, then says thanks', async () => {
    const onSubmit = vi.fn().mockResolvedValue(null);
    render(<ReportForm handle="nadia" displayName="Nadia Bakes" language="en" onSubmit={onSubmit} />);

    await userEvent.click(screen.getByRole('radio', { name: 'Wrong prices or details' }));
    await userEvent.type(screen.getByLabelText('More details (optional)'), 'Kek is RM50, not RM95');
    await userEvent.click(screen.getByRole('button', { name: 'Send report' }));

    expect(onSubmit).toHaveBeenCalledWith({ reason: 'WRONG_PRICES', details: 'Kek is RM50, not RM95' });
    expect(await screen.findByRole('heading', { name: 'Thanks' })).toBeInTheDocument();
    expect(screen.getByText('The Curios team will look at it.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send report' })).toBeNull();
    // The way back to the page, in the nav and under the line.
    for (const link of screen.getAllByRole('link', { name: 'Back to Nadia Bakes' })) expect(link).toHaveAttribute('href', '/nadia');
    expect(screen.getAllByRole('link', { name: 'Back to Nadia Bakes' })).toHaveLength(2);
  });

  it('leaves details out when none were typed', async () => {
    const onSubmit = vi.fn().mockResolvedValue(null);
    render(<ReportForm handle="nadia" displayName="Nadia Bakes" language="en" onSubmit={onSubmit} />);

    await userEvent.click(screen.getByRole('radio', { name: 'Offensive' }));
    await userEvent.click(screen.getByRole('button', { name: 'Send report' }));
    expect(onSubmit).toHaveBeenCalledWith({ reason: 'OFFENSIVE' });
  });

  it('says why when there have been too many', async () => {
    render(
      <ReportForm handle="nadia" displayName="Nadia Bakes" language="en" onSubmit={vi.fn().mockRejectedValue(new ApiError(429, 'RATE_LIMITED', 'slow down'))} />,
    );
    await userEvent.click(screen.getByRole('radio', { name: 'Something else' }));
    await userEvent.click(screen.getByRole('button', { name: 'Send report' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Too many reports from here. Try again later.');
    expect(screen.getByRole('button', { name: 'Send report' })).toBeEnabled();
  });

  it('says a failure in Malay on a Malay page, never the raw message', async () => {
    render(
      <ReportForm
        handle="nadia"
        displayName="Nadia Bakes"
        language="ms"
        onSubmit={vi.fn().mockRejectedValue(new ApiError(500, 'INTERNAL_ERROR', 'Something failed on our side. Try again.'))}
      />,
    );
    await userEvent.click(screen.getByRole('radio', { name: 'Lain-lain' }));
    await userEvent.click(screen.getByRole('button', { name: 'Hantar laporan' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Ada masalah. Cuba lagi.');
  });

  it('says a dropped connection in Malay too, and the 429 in Malay', async () => {
    const onSubmit = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockRejectedValueOnce(new ApiError(429, 'RATE_LIMITED', 'slow down'));
    render(<ReportForm handle="nadia" displayName="Nadia Bakes" language="ms" onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Lain-lain' }));
    await userEvent.click(screen.getByRole('button', { name: 'Hantar laporan' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Ada masalah. Cuba lagi.');

    await userEvent.click(screen.getByRole('button', { name: 'Hantar laporan' }));
    expect(await screen.findByText('Terlalu banyak laporan dari sini. Cuba lagi nanti.')).toBeInTheDocument();
  });

  it('says a failure in English on an English page, never the raw message', async () => {
    render(
      <ReportForm handle="nadia" displayName="Nadia Bakes" language="en" onSubmit={vi.fn().mockRejectedValue(new ApiError(404, 'PAGE_NOT_FOUND', 'No such page.'))} />,
    );
    await userEvent.click(screen.getByRole('radio', { name: 'Something else' }));
    await userEvent.click(screen.getByRole('button', { name: 'Send report' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Try again.');
  });

  it('speaks Malay for a Malay page', async () => {
    const onSubmit = vi.fn().mockResolvedValue(null);
    render(<ReportForm handle="nadia" displayName="Nadia Bakes" language="ms" onSubmit={onSubmit} />);

    expect(screen.getByRole('heading', { name: 'Laporkan Nadia Bakes' })).toBeInTheDocument();
    expect(screen.getByText('Beritahu pasukan Curios apa yang salah. Pemilik tidak diberitahu siapa yang melaporkan.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'Menyamar sebagai orang lain' }));
    await userEvent.type(screen.getByLabelText('Butiran lanjut (pilihan)'), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Hantar laporan' }));
    expect(onSubmit).toHaveBeenCalledWith({ reason: 'IMPERSONATION', details: 'x' });
    expect(await screen.findByRole('heading', { name: 'Terima kasih' })).toBeInTheDocument();
    expect(screen.getByText('Pasukan Curios akan menyemaknya.')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Kembali ke Nadia Bakes' })).toHaveLength(2);
  });
});
