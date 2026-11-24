import { beforeEach, describe, expect, it, vi } from 'vitest';

// Throws, because the real `redirect` throws NEXT_REDIRECT.
const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});
vi.mock('next/navigation', () => ({ redirect }));

const PaidPage = (await import('./paid/page.js')).default;
const FailedPage = (await import('./failed/page.js')).default;

beforeEach(() => {
  redirect.mockClear();
});

describe('the old result pages', () => {
  it('send an old paid link to Billing, with the payment to look up', async () => {
    await expect(PaidPage({ searchParams: Promise.resolve({ payment: 'pay-1' }) })).rejects.toThrow('NEXT_REDIRECT:/app/billing?paid=pay-1');
  });

  it('drop card=off: Billing works that out itself', async () => {
    await expect(PaidPage({ searchParams: Promise.resolve({ payment: 'pay-1', card: 'off' }) })).rejects.toThrow(/^NEXT_REDIRECT:\/app\/billing\?paid=pay-1$/);
  });

  it('send an old failed link to Billing too', async () => {
    await expect(FailedPage({ searchParams: Promise.resolve({ payment: 'pay-2', reason: 'expired' }) })).rejects.toThrow('NEXT_REDIRECT:/app/billing?failed=pay-2');
  });

  it('send a link with no payment to plain Billing', async () => {
    await expect(PaidPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('NEXT_REDIRECT:/app/billing');
    await expect(FailedPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('NEXT_REDIRECT:/app/billing');
  });

  it('encode a hand-typed id rather than carrying it into the query', async () => {
    await expect(PaidPage({ searchParams: Promise.resolve({ payment: 'a&paid=b' }) })).rejects.toThrow('NEXT_REDIRECT:/app/billing?paid=a%26paid%3Db');
  });
});
