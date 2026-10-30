import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { fullFrame } from '@curios/core/item-photos';
import { InvalidItemPhotoError } from '../modules/store/store.errors.js';
import { cutSquare, readPicture } from './item-photo-image.js';

const png = (width: number, height: number, background = '#888') =>
  sharp({ create: { width, height, channels: 3, background } }).png().toBuffer();

describe('readPicture', () => {
  it('reads an 800x600 PNG', async () => {
    expect(await readPicture(await png(800, 600), 'image/png')).toEqual({ width: 800, height: 600, ext: 'png' });
  });

  it('reports the upright size of an EXIF-rotated JPEG', async () => {
    const jpg = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#888' } })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    expect(await readPicture(jpg, 'image/jpeg')).toEqual({ width: 600, height: 800, ext: 'jpg' });
  });

  it('rejects PNG bytes declared as JPEG', async () => {
    await expect(readPicture(await png(10, 10), 'image/jpeg')).rejects.toBeInstanceOf(InvalidItemPhotoError);
  });

  it('rejects random bytes', async () => {
    await expect(readPicture(Buffer.from('not a picture at all'), 'image/png')).rejects.toBeInstanceOf(InvalidItemPhotoError);
  });

  it('rejects a body over 8 MB', async () => {
    const body = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(9 * 1024 * 1024)]);
    await expect(readPicture(body, 'image/png')).rejects.toBeInstanceOf(InvalidItemPhotoError);
  });

  // A decompression bomb: one colour compresses to almost nothing, but decoding it would allocate
  // 8000 x 8000 x 3 bytes. It is refused by the pixel limit, before any of that is allocated.
  it('rejects a small PNG that declares more than 40 MP', async () => {
    const bomb = await sharp({ create: { width: 8000, height: 8000, channels: 3, background: '#888' } })
      .png({ compressionLevel: 9 })
      .toBuffer();
    expect(bomb.length).toBeLessThan(1024 * 1024);
    await expect(readPicture(bomb, 'image/png')).rejects.toBeInstanceOf(InvalidItemPhotoError);
  });

  it('rejects a signature-valid but undecodable body', async () => {
    const body = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100)]);
    await expect(readPicture(body, 'image/png')).rejects.toBeInstanceOf(InvalidItemPhotoError);
  });
});

describe('cutSquare', () => {
  it('makes a WebP at the asked edge', async () => {
    const out = await cutSquare(await png(800, 600), fullFrame(800, 600), 1080);
    const meta = await sharp(out).metadata();
    expect(meta).toMatchObject({ format: 'webp', width: 1080, height: 1080 });
  });

  it('cuts the left half red', async () => {
    const src = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#0000ff' } })
      .composite([{ input: { create: { width: 400, height: 600, channels: 3, background: '#ff0000' } }, left: 0, top: 0 }])
      .png()
      .toBuffer();
    const out = await cutSquare(src, { x: 0, y: 0, size: 400 / 600 }, 200);
    const stats = await sharp(out).stats();
    expect(stats.channels[0]!.mean).toBeGreaterThan(200);
  });
});
