import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@curios/db-read', () => ({ getPublicPage: vi.fn(), getPageAvailability: vi.fn() }));
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

const { getPageAvailability, getPublicPage } = await import('@curios/db-read');
const { default: ReportPage, generateMetadata } = await import('./page.js');

const params = (handle: string) => ({ params: Promise.resolve({ handle }) });

describe('the report page', () => {
  it('is the form for a live page, in its language, and is not indexed', async () => {
    vi.mocked(getPublicPage).mockResolvedValue({ handle: 'nadia', displayName: 'Nadia Bakes', language: 'ms' } as never);
    render(await ReportPage(params('nadia')));
    expect(screen.getByRole('heading', { name: 'Laporkan Nadia Bakes' })).toBeInTheDocument();
    expect((await generateMetadata(params('nadia'))).robots).toEqual({ index: false, follow: false });
  });

  it('shows what the page shows when it is suspended, and 404s when it is missing', async () => {
    vi.mocked(getPublicPage).mockResolvedValue(null);
    vi.mocked(getPageAvailability).mockResolvedValue({ status: 'suspended', language: 'en' });
    render(await ReportPage(params('nadia')));
    expect(screen.getByRole('heading', { name: 'This page is unavailable' })).toBeInTheDocument();

    vi.mocked(getPageAvailability).mockResolvedValue({ status: 'missing', language: 'en' });
    await expect(ReportPage(params('nobody'))).rejects.toThrow('NEXT_NOT_FOUND');
    expect((await generateMetadata(params('nobody'))).robots).toEqual({ index: false, follow: false });
  });
});
