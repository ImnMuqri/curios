import jsQR from 'jsqr';
import QRCode from 'qrcode';
import sharp from 'sharp';

/**
 * The owner's DuitNow QR, redrawn: the payment text is read out of the
 * uploaded picture and drawn again as a clean QR in DuitNow's pink. A
 * screenshot, a photo of a poster at an angle, a crop with the bank's banner
 * around it all come out the same crisp square, and the customer's download is
 * a QR rather than somebody's photo.
 *
 * Only the colour changes. The text is the owner's, byte for byte, so it pays
 * exactly where the original did.
 */

/** DuitNow's pink, as the design board draws the DuitNow QR mark: dark enough on white for any scanner. */
export const DUITNOW_PINK = '#b5294e';

/** Starts the file name of every redrawn QR (`qr/<pageId>/duitnow-<uuid>.png`), so a QR uploaded before redrawing can be told apart. */
export const REDRAWN_PREFIX = 'duitnow-';

export class UnreadableQrError extends Error {
  readonly statusCode = 400;
  readonly code = 'QR_UNREADABLE';
  constructor() {
    super('We couldn’t read a DuitNow QR in this picture. Upload a clear screenshot of your QR, with the whole square in view.');
    this.name = 'UnreadableQrError';
  }
}

/** CRC-16/CCITT-FALSE, the checksum EMVCo payment QRs end with (tag 63). */
export function crc16(text: string): string {
  let crc = 0xffff;
  for (const byte of Buffer.from(text, 'utf8')) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/** The top-level tags of an EMVCo payload, or null when it is not one (each tag: 2-digit id, 2-digit length, value). */
function emvTags(payload: string): Map<string, string> | null {
  const tags = new Map<string, string>();
  let at = 0;
  while (at < payload.length) {
    const id = payload.slice(at, at + 2);
    const length = Number(payload.slice(at + 2, at + 4));
    if (!/^\d{2}$/.test(id) || !/^\d{2}$/.test(payload.slice(at + 2, at + 4)) || at + 4 + length > payload.length) return null;
    tags.set(id, payload.slice(at + 4, at + 4 + length));
    at += 4 + length;
  }
  return tags;
}

/**
 * Whether this is a Malaysian EMVCo payment QR, the format DuitNow QR uses:
 * the format tag first, a checksum that matches, and Malaysia as the country.
 * A link, a WhatsApp QR or a damaged read fails here rather than reaching a
 * customer.
 */
export function isDuitNowPayload(payload: string): boolean {
  const tags = emvTags(payload);
  if (!tags || !payload.startsWith('000201') || tags.get('58') !== 'MY') return false;
  const crc = tags.get('63');
  return crc !== undefined && payload.endsWith(`6304${crc}`) && crc16(payload.slice(0, -4)) === crc.toUpperCase();
}

/** The QR's text from a picture, or null. Tried at two sizes: a large photo reads better scaled down. */
async function readQr(picture: Buffer): Promise<string | null> {
  for (const size of [1400, 800]) {
    const { data, info } = await sharp(picture)
      .rotate()
      .resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
      .catch(() => ({ data: null, info: null }));
    if (!data || !info) return null;
    const found = jsQR(new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), info.width, info.height, { inversionAttempts: 'attemptBoth' });
    if (found?.data) return found.data;
  }
  return null;
}

/** The DuitNow QR in `picture`, redrawn in pink as a PNG. Throws UnreadableQrError when there is none to read. */
export async function redrawDuitNowQr(picture: Buffer): Promise<Buffer> {
  const payload = await readQr(picture);
  if (!payload || !isDuitNowPayload(payload)) throw new UnreadableQrError();
  const png = await QRCode.toBuffer(payload, {
    type: 'png',
    errorCorrectionLevel: 'M',
    margin: 4,
    width: 720,
    color: { dark: `${DUITNOW_PINK}ff`, light: '#ffffffff' },
  });
  // The redrawn QR must read back as exactly what the owner uploaded, or it is not kept.
  if ((await readQr(png)) !== payload) throw new UnreadableQrError();
  return png;
}
