import { afterEach, describe, expect, it, vi } from 'vitest';
import { containedSize, prepareOriginal, resizeContained, resizeImage } from './resize-image.js';

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

describe('containedSize', () => {
  it('scales a portrait screenshot to fit its long edge, keeping its shape', () => {
    expect(containedSize(1080, 2340)).toEqual({ width: 473, height: 1024 });
  });

  it('scales a landscape picture the same way', () => {
    expect(containedSize(4000, 3000)).toEqual({ width: 1024, height: 768 });
  });

  it('never scales a small picture up', () => {
    expect(containedSize(300, 200)).toEqual({ width: 300, height: 200 });
  });
});

describe('resizeContained', () => {
  // A payment QR must not lose its edges to a crop, nor its modules to a lossy
  // encode, so the picture is drawn whole and PNG is asked for first.
  it('draws the whole picture, scaled to fit, and asks for a PNG', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 1080, height: 2340 }) as unknown as ImageBitmap));
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
    const toBlob = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback: BlobCallback) => {
      callback(fakeBlob(1, 'image/png'));
    });

    const result = await resizeContained(new File(['x'], 'qr.png', { type: 'image/png' }));

    expect(result.contentType).toBe('image/png');
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 473, 1024);
    expect(toBlob.mock.calls[0]?.[1]).toBe('image/png');
  });

  it('falls back to high-quality WebP when the PNG is over the limit', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 800, height: 600 }) as unknown as ImageBitmap));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback: BlobCallback, type?: string) => {
      callback(type === 'image/png' ? fakeBlob(1_100_000, 'image/png') : fakeBlob(200_000, 'image/webp'));
    });

    const result = await resizeContained(new File(['x'], 'qr.png', { type: 'image/png' }));

    expect(result.contentType).toBe('image/webp');
  });

  it('refuses a picture that no encoding brings under 1 MB', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 800, height: 600 }) as unknown as ImageBitmap));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback: BlobCallback) => {
      callback(fakeBlob(1_100_000, 'image/webp'));
    });

    await expect(resizeContained(new File(['x'], 'qr.png', { type: 'image/png' }))).rejects.toThrow(/too large/i);
  });
});

describe('prepareOriginal', () => {
  const picture = () => new File(['x'], 'cake.jpg', { type: 'image/jpeg' });

  function drawn(width: number, height: number) {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width, height }) as unknown as ImageBitmap));
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback: BlobCallback) => {
      callback(fakeBlob(1, 'image/webp'));
    });
    return drawImage;
  }

  it('scales a 4000x3000 picture so its longest side is 2400', async () => {
    const drawImage = drawn(4000, 3000);
    const result = await prepareOriginal(picture());
    expect(result).toMatchObject({ width: 2400, height: 1800 });
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 2400, 1800);
  });

  it('never scales a smaller picture up', async () => {
    const drawImage = drawn(1000, 800);
    const result = await prepareOriginal(picture());
    expect(result).toMatchObject({ width: 1000, height: 800 });
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1000, 800);
  });

  it('keeps whatever format the browser made, and steps the quality down to fit under 8 MB', async () => {
    drawn(1000, 800);
    const sizes = [9_000_000, 7_000_000];
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback: BlobCallback) => {
      callback(fakeBlob(sizes.shift() ?? 1, 'image/png'));
    });
    const result = await prepareOriginal(picture());
    expect(result.blob.type).toBe('image/png');
    expect(result.blob.size).toBe(7_000_000);
  });

  it('says so when the picture cannot be decoded', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => { throw new Error('nope'); }));
    await expect(prepareOriginal(picture())).rejects.toThrow('This picture could not be opened. Try a JPEG or PNG.');
  });

  it('refuses a picture still over 8 MB after every step', async () => {
    drawn(1000, 800);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback: BlobCallback) => {
      callback(fakeBlob(9_000_000, 'image/webp'));
    });
    await expect(prepareOriginal(picture())).rejects.toThrow(/too large/i);
  });
});
