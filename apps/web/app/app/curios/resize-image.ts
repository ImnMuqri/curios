export const AVATAR_EDGE = 512;

/**
 * The picture, cropped to a centred square and scaled to AVATAR_EDGE, as WebP
 * base64 -- small enough to send inside JSON (see Task 9's note on why JSON).
 */
export async function resizeImage(file: File, edge = AVATAR_EDGE): Promise<{ contentType: 'image/webp'; data: string }> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = edge;
  canvas.height = edge;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser cannot prepare the picture.');
  context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, edge, edge);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The picture could not be prepared.'))), 'image/webp', 0.85),
  );
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return { contentType: 'image/webp', data: btoa(binary) };
}
