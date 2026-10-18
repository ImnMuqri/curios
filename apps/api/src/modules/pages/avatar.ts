export const AVATAR_MAX_BYTES = 1_048_576;

/** A cover is wide and shown full-bleed, so it may be bigger than a profile picture. */
export const COVER_MAX_BYTES = 2_097_152;

export class InvalidImageError extends Error {
  readonly statusCode = 400;
  readonly code = 'INVALID_IMAGE';
  constructor(maxBytes: number = AVATAR_MAX_BYTES) {
    super(`That picture could not be used. Upload a JPEG, PNG or WebP under ${Math.round(maxBytes / 1_048_576)} MB.`);
    this.name = 'InvalidImageError';
  }
}

const SIGNATURES = {
  'image/jpeg': { ext: 'jpg', matches: (b: Buffer) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/png': { ext: 'png', matches: (b: Buffer) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/webp': { ext: 'webp', matches: (b: Buffer) => b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' },
} as const;

/**
 * An uploaded picture as bytes, checked. The declared content type is a
 * claim; the file's first bytes are the evidence, and they must agree.
 */
export function decodeImage(
  input: { contentType: string; data: string },
  maxBytes: number,
): { body: Buffer; ext: 'jpg' | 'png' | 'webp' } {
  const signature = SIGNATURES[input.contentType as keyof typeof SIGNATURES];
  if (!signature) throw new InvalidImageError(maxBytes);
  const body = Buffer.from(input.data, 'base64');
  if (body.length === 0 || body.length > maxBytes || !signature.matches(body)) throw new InvalidImageError(maxBytes);
  return { body, ext: signature.ext };
}

export class InvalidReceiptError extends Error {
  readonly statusCode = 400;
  readonly code = 'INVALID_RECEIPT';
  constructor() {
    super('Upload a photo or PDF of your receipt, up to 5 MB.');
    this.name = 'InvalidReceiptError';
  }
}

const RECEIPT_SIGNATURES = {
  ...SIGNATURES,
  'application/pdf': { ext: 'pdf', matches: (b: Buffer) => b.toString('ascii', 0, 5) === '%PDF-' },
} as const;

/**
 * An uploaded receipt as bytes: a picture or a PDF, checked as decodeImage
 * checks a picture -- by its first bytes, which must agree with the claimed type.
 */
export function decodeReceipt(
  input: { contentType: string; data: string },
  maxBytes: number,
): { body: Buffer; ext: 'jpg' | 'png' | 'webp' | 'pdf' } {
  const signature = (RECEIPT_SIGNATURES as Record<string, { ext: 'jpg' | 'png' | 'webp' | 'pdf'; matches: (b: Buffer) => boolean }>)[input.contentType];
  if (!signature || !Object.hasOwn(RECEIPT_SIGNATURES, input.contentType)) throw new InvalidReceiptError();
  const body = Buffer.from(input.data, 'base64');
  if (body.length === 0 || body.length > maxBytes || !signature.matches(body)) throw new InvalidReceiptError();
  return { body, ext: signature.ext };
}

/** The profile picture: the same checks, at its own size limit. */
export function decodeAvatar(input: { contentType: string; data: string }): { body: Buffer; ext: 'jpg' | 'png' | 'webp' } {
  return decodeImage(input, AVATAR_MAX_BYTES);
}
