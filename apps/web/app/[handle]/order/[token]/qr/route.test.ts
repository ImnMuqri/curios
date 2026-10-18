import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicOrder } from '@curios/db-read';

vi.mock('@curios/db-read', () => ({ getOrderByToken: vi.fn() }));

const { getOrderByToken } = await import('@curios/db-read');
const { GET } = await import('./route.js');

const page = (paymentQrKey: string | null) =>
  ({ handle: 'keklina', displayName: 'Kek Lina', paymentQrKey }) as unknown as PublicOrder['page'];
const order = (paymentQrKey: string | null = 'qr/p1/abc.png') => ({ page: page(paymentQrKey) }) as unknown as PublicOrder;

const call = (handle: string, token = 'tok') => GET(new Request(`http://localhost/${handle}/order/${token}/qr`), { params: Promise.resolve({ handle, token }) });

beforeEach(() => vi.stubEnv('STORAGE_PUBLIC_URL', 'https://cdn.test'));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.mocked(getOrderByToken).mockReset();
});

describe('GET /[handle]/order/[token]/qr', () => {
  it('sends the page’s QR as an attachment, with its type', async () => {
    vi.mocked(getOrderByToken).mockResolvedValueOnce(order());
    const fetchSpy = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/webp' } }));
    vi.stubGlobal('fetch', fetchSpy);

    const response = await call('KekLina');
    expect(fetchSpy).toHaveBeenCalledWith('https://cdn.test/qr/p1/abc.png');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/webp');
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="keklina-qr.webp"');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('is a 404 for an unknown token, another page’s order, or a page with no QR', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    vi.mocked(getOrderByToken).mockResolvedValueOnce(null);
    expect((await call('keklina')).status).toBe(404);
    vi.mocked(getOrderByToken).mockResolvedValueOnce(order());
    expect((await call('otherpage')).status).toBe(404);
    vi.mocked(getOrderByToken).mockResolvedValueOnce(order(null));
    expect((await call('keklina')).status).toBe(404);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('is a 404 when storage has no such picture', async () => {
    vi.mocked(getOrderByToken).mockResolvedValueOnce(order());
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('no', { status: 404 })));
    expect((await call('keklina')).status).toBe(404);
  });
});
