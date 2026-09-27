export const AVATAR_EDGE = 512;

// Mirrors AVATAR_MAX_BYTES in apps/api/src/modules/pages/avatar.ts. The web
// app and the API are separate deployables with no shared package for this
// one number, so this is a second definition of it, not a stand-in for one --
// the API re-checks the byte length regardless of what this already refused.
const AVATAR_MAX_BYTES = 1_048_576;

// What the API's `decodeAvatar` actually accepts (its magic-byte check has no
// fourth case). Declaring anything else would be refused as INVALID_IMAGE no
// matter how well-formed the bytes are.
const ACCEPTED_TYPES = new Set(['image/webp', 'image/png', 'image/jpeg']);

function encode(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The picture could not be prepared.'))), 'image/webp', quality),
  );
}

/**
 * The picture, cropped to a centred square and scaled to AVATAR_EDGE, as
 * base64 -- small enough to send inside JSON (see the build spec's note on
 * why JSON, not multipart).
 *
 * The content type is whatever the browser actually produced, not always
 * `image/webp`: Safari's `canvas.toBlob` silently returns PNG when asked for
 * WebP, and the API matches the declared type against the bytes' own magic
 * numbers, so claiming webp for PNG bytes is refused as INVALID_IMAGE on
 * every iPhone upload. A blob still over the 1 MB limit after encoding is
 * retried at lower quality a few times before giving up with a clear message,
 * rather than uploading something the API is going to refuse anyway.
 */
export async function resizeImage(file: File, edge = AVATAR_EDGE): Promise<{ contentType: string; data: string }> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = edge;
  canvas.height = edge;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser cannot prepare the picture.');
  context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, edge, edge);

  let blob = await encode(canvas, 0.85);
  for (const quality of [0.7, 0.5, 0.35]) {
    if (blob.size <= AVATAR_MAX_BYTES) break;
    blob = await encode(canvas, quality);
  }
  if (blob.size > AVATAR_MAX_BYTES) {
    throw new Error('That picture is too large even resized. Try a smaller or simpler photo.');
  }
  if (!ACCEPTED_TYPES.has(blob.type)) {
    throw new Error('This browser produced a picture in a format that cannot be uploaded.');
  }

  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return { contentType: blob.type, data: btoa(binary) };
}
