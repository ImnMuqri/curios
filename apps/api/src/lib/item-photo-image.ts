import sharp from 'sharp';
import { framePixels, ITEM_PHOTO_ORIGINAL_MAX_BYTES, type Frame } from '@curios/core/item-photos';
import { SIGNATURES } from '../modules/pages/avatar.js';
import { InvalidItemPhotoError } from '../modules/store/store.errors.js';

/**
 * A picture the owner sent, checked: its first bytes agree with the claimed
 * type, it fits the size limit, and sharp can read it. Dimensions are the
 * upright ones (after EXIF orientation).
 */
export async function readPicture(
  body: Buffer,
  contentType: string,
): Promise<{ width: number; height: number; ext: 'jpg' | 'png' | 'webp' }> {
  if (!Object.hasOwn(SIGNATURES, contentType)) throw new InvalidItemPhotoError();
  const signature = SIGNATURES[contentType as keyof typeof SIGNATURES];
  if (body.length === 0 || body.length > ITEM_PHOTO_ORIGINAL_MAX_BYTES || !signature.matches(body)) {
    throw new InvalidItemPhotoError();
  }
  try {
    // Decode fully: a header that parses is not proof the pixels do.
    const { info } = await sharp(body).rotate().raw().toBuffer({ resolveWithObject: true });
    return { width: info.width, height: info.height, ext: signature.ext };
  } catch {
    throw new InvalidItemPhotoError();
  }
}

/** The owner's square of an original: upright, cut to the frame, at `edge` pixels. */
export async function cutSquare(original: Buffer, frame: Frame, edge: number): Promise<Buffer> {
  const { width, height } = await uprightSize(original);
  const { left, top, side } = framePixels(frame, width, height);
  return sharp(original)
    .rotate()
    .extract({ left, top, width: side, height: side })
    .resize(edge, edge)
    .webp({ quality: 82 })
    .toBuffer();
}

async function uprightSize(body: Buffer): Promise<{ width: number; height: number }> {
  const { width = 0, height = 0, orientation = 1 } = await sharp(body).metadata();
  return orientation >= 5 ? { width: height, height: width } : { width, height };
}
