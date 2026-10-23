import { getOrderByToken } from '@curios/db-read';
import { avatarUrl } from '../../../../../lib/avatar-url.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const EXTENSION: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

const notFound = () => new Response('Not found', { status: 404, headers: { 'Cache-Control': 'private, no-store' } });

/**
 * The shop's payment QR, from this app's own address, so the order page's
 * save button is a plain download link: a `download` attribute is ignored
 * across origins, and storage sends no CORS for a fetch. It serves only the QR
 * of the page that owns the order the token names; no other key can be asked
 * for, so it is not a proxy onto storage.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ handle: string; token: string }> }) {
  const { handle, token } = await params;
  const order = await getOrderByToken(token);
  if (!order || order.page.handle !== handle.toLowerCase() || order.page.suspended) return notFound();
  const url = avatarUrl(order.page.paymentQrKey);
  if (!url) return notFound();

  // Ten seconds, then a 404 like any other storage failure: a hung bucket must not hold the request open.
  const upstream = await fetch(url, { signal: AbortSignal.timeout(10_000) }).catch(() => null);
  if (!upstream?.ok || !upstream.body) return notFound();
  const type = (upstream.headers.get('content-type') ?? 'image/png').split(';')[0]!.trim();
  const ext = EXTENSION[type] ?? 'png';

  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': type,
      'Content-Disposition': `attachment; filename="${order.page.handle}-qr.${ext}"`,
      'Cache-Control': 'private, no-store',
      'Referrer-Policy': 'no-referrer',
    },
  });
}
