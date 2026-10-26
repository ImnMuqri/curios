import { describe, expect, it } from 'vitest';
import jsQR from 'jsqr';
import QRCode from 'qrcode';
import sharp from 'sharp';
import { crc16, DUITNOW_PINK, isDuitNowPayload, redrawDuitNowQr } from './payment-qr.js';

const tlv = (id: string, value: string) => `${id}${String(value.length).padStart(2, '0')}${value}`;
/** A static DuitNow-shaped payload, checksum and all. */
function duitNow(fields: { country?: string } = {}): string {
  const body = [
    tlv('00', '01'),
    tlv('01', '11'),
    tlv('26', tlv('00', 'A0000006150001') + tlv('01', '890014') + tlv('02', '0000000012345678')),
    tlv('52', '5462'),
    tlv('53', '458'),
    tlv('58', fields.country ?? 'MY'),
    tlv('59', 'KEK LINA'),
    tlv('60', 'SHAH ALAM'),
  ].join('');
  return `${body}6304${crc16(`${body}6304`)}`;
}

/** A screenshot-like picture: a plain black QR somewhere on a larger grey canvas. */
async function screenshotOf(text: string): Promise<Buffer> {
  const qr = await QRCode.toBuffer(text, { type: 'png', width: 300, margin: 2 });
  return sharp({ create: { width: 900, height: 1400, channels: 3, background: '#eeeeee' } })
    .composite([{ input: qr, left: 260, top: 480 }])
    .jpeg({ quality: 85 })
    .toBuffer();
}

async function read(png: Buffer): Promise<{ text: string | null; inks: Set<string> }> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const inks = new Set<string>();
  for (let i = 0; i < data.length; i += 4) inks.add(`#${[data[i]!, data[i + 1]!, data[i + 2]!].map((c) => c.toString(16).padStart(2, '0')).join('')}`);
  return { text: jsQR(new Uint8ClampedArray(data), info.width, info.height)?.data ?? null, inks };
}

describe('the payment QR', () => {
  it('checks sums the way EMVCo does', () => {
    expect(crc16('123456789')).toBe('29B1');
  });

  it('knows a Malaysian payment QR from a link, a foreign one and a damaged read', () => {
    expect(isDuitNowPayload(duitNow())).toBe(true);
    expect(isDuitNowPayload('https://wa.me/60123456789')).toBe(false);
    expect(isDuitNowPayload(duitNow({ country: 'SG' }))).toBe(false);
    expect(isDuitNowPayload(duitNow().replace('KEK LINA', 'KEK LINE'))).toBe(false);
  });

  it('redraws the QR in a screenshot as a pink QR that pays to exactly the same place', async () => {
    const payload = duitNow();
    const redrawn = await redrawDuitNowQr(await screenshotOf(payload));
    const { text, inks } = await read(redrawn);
    expect(text).toBe(payload);
    expect([...inks].sort()).toEqual([DUITNOW_PINK, '#ffffff'].sort());
  });

  it('refuses a QR that is not a payment QR, a picture with no QR, and something that is not a picture', async () => {
    await expect(redrawDuitNowQr(await screenshotOf('https://wa.me/60123456789'))).rejects.toMatchObject({ code: 'QR_UNREADABLE' });
    const blank = await sharp({ create: { width: 400, height: 400, channels: 3, background: '#ffffff' } }).png().toBuffer();
    await expect(redrawDuitNowQr(blank)).rejects.toMatchObject({ code: 'QR_UNREADABLE' });
    await expect(redrawDuitNowQr(Buffer.from('not a picture'))).rejects.toMatchObject({ code: 'QR_UNREADABLE' });
  });
});
