import { afterEach, describe, expect, it, vi } from 'vitest';
import { resizeImage } from './resize-image.js';

/**
 * jsdom's own Blob has no `arrayBuffer()`, so a real `new Blob(...)` cannot
 * stand in for one here; this is the minimal shape `resizeImage` actually
 * reads off it.
 */
function fakeBlob(size: number, type: string): Blob {
  return {
    size,
    type,
    arrayBuffer: async () => new ArrayBuffer(size),
  } as unknown as Blob;
}

/**
 * jsdom has no real canvas 2D context or encoder, so both are stubbed. The
 * fixed `blob` is what every call to `toBlob` returns, regardless of the
 * quality it was asked for -- which is exactly the shape of the two bugs
 * this covers: Safari's real `canvas.toBlob` also ignores the requested
 * type once it falls back to PNG, and a photo that is still too big after
 * one pass is still too big after a differently-numbered one, since nothing
 * here actually re-encodes.
 */
function stubCanvas(blob: Blob) {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    { drawImage: vi.fn() } as unknown as CanvasRenderingContext2D,
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback: BlobCallback) => {
    callback(blob);
  });
}

function stubBitmap() {
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => ({ width: 800, height: 600 }) as unknown as ImageBitmap),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('resizeImage', () => {
  // Important #4: Safari's canvas.toBlob returns PNG when asked for WebP,
  // and the API's decodeAvatar rejects PNG bytes declared image/webp -- so a
  // hard-coded `contentType: 'image/webp'` fails every iPhone upload.
  it('declares the content type the browser actually produced, not always webp', async () => {
    stubBitmap();
    stubCanvas(fakeBlob(1, 'image/png'));

    const result = await resizeImage(new File(['x'], 'me.heic', { type: 'image/heic' }));

    expect(result.contentType).toBe('image/png');
  });

  it('still declares webp when the browser actually produces it', async () => {
    stubBitmap();
    stubCanvas(fakeBlob(1, 'image/webp'));

    const result = await resizeImage(new File(['x'], 'me.png', { type: 'image/png' }));

    expect(result.contentType).toBe('image/webp');
  });

  // The build spec's revision note: a browser-side size check before upload,
  // not just the API's after-the-fact one.
  it('refuses a picture that is still over 1 MB after resizing', async () => {
    stubBitmap();
    stubCanvas(fakeBlob(1_100_000, 'image/webp'));

    await expect(resizeImage(new File(['x'], 'big.png', { type: 'image/png' }))).rejects.toThrow(/too large/i);
  });

  it('accepts a picture right at the limit', async () => {
    stubBitmap();
    stubCanvas(fakeBlob(1_048_576, 'image/webp'));

    await expect(resizeImage(new File(['x'], 'exact.png', { type: 'image/png' }))).resolves.toMatchObject({
      contentType: 'image/webp',
    });
  });
});
