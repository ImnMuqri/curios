/**
 * The rules of an item's photos, shared by the API (which crops with sharp) and the
 * owner's crop window in the browser -- so the window cannot offer a crop the API refuses.
 *
 * Imports nothing, so client components load it through `@curios/core/item-photos`.
 *
 * A photo is a square frame on the original picture. The frame is kept as fractions of the
 * picture (x and y of its top-left corner against the width and height, size against the
 * picture's shorter side), so it survives the original being stored at a different size.
 */

export const MAX_ITEM_PHOTOS = 8;
/** The edge, in pixels, of the square a photo is cropped to. */
export const ITEM_PHOTO_EDGE = 1080;
/** The edge, in pixels, of the small square used on the shop's cards. */
export const ITEM_COVER_EDGE = 512;
/** The longest edge the stored original is shrunk to. */
export const ORIGINAL_MAX_EDGE = 2400;
/** The smallest crop, and the smallest picture, in pixels. */
export const MIN_FRAME_PX = 200;
/** 8 MB: the biggest picture the owner may upload. */
export const ITEM_PHOTO_ORIGINAL_MAX_BYTES = 8_388_608;

export const TOO_SMALL_SENTENCE = 'This picture is too small. Pick one at least 200 pixels on each side.';

/** A square on the original, as fractions: x and y of the width and height, size of the shorter side. */
export type Frame = { x: number; y: number; size: number };

const clamp = (n: number, lo: number, hi: number): number => Math.min(Math.max(n, lo), hi);

/** The frame in whole pixels, clamped so the square lies inside the picture. */
export function framePixels(
  frame: Frame,
  width: number,
  height: number,
): { left: number; top: number; side: number } {
  const side = Math.min(Math.round(frame.size * Math.min(width, height)), width, height);
  const left = clamp(Math.round(frame.x * width), 0, width - side);
  const top = clamp(Math.round(frame.y * height), 0, height - side);
  return { left, top, side };
}

/** The largest square, centred. */
export function fullFrame(width: number, height: number): Frame {
  const side = Math.min(width, height);
  return { x: (width - side) / 2 / width, y: (height - side) / 2 / height, size: 1 };
}

/** The sentence to show the owner when the frame cannot be cropped, or null when it can. */
export function frameProblem(frame: Frame, width: number, height: number): string | null {
  if (![frame.x, frame.y, frame.size, width, height].every(Number.isFinite)) {
    return 'That crop is not a valid square. Drag the square again.';
  }
  if (frame.size <= 0 || frame.size > 1) {
    return 'That crop is not a valid square. Drag the square again.';
  }
  const shorter = Math.min(width, height);
  if (shorter < MIN_FRAME_PX) return TOO_SMALL_SENTENCE;
  const side = frame.size * shorter;
  if (Math.round(side) < MIN_FRAME_PX) {
    return `The square is too small. Make it at least ${MIN_FRAME_PX} pixels on each side.`;
  }
  const eps = 1e-6;
  const left = frame.x * width;
  const top = frame.y * height;
  if (left < -eps || top < -eps || left + side > width + eps || top + side > height + eps) {
    return 'Keep the square inside the picture.';
  }
  return null;
}

function fromPixels(left: number, top: number, side: number, width: number, height: number): Frame {
  return { x: left / width, y: top / height, size: side / Math.min(width, height) };
}

/** Slide the square by a number of pixels; it stops at the edges of the picture. */
export function moveFrame(frame: Frame, dxPx: number, dyPx: number, width: number, height: number): Frame {
  const { left, top, side } = framePixels(frame, width, height);
  const dx = Number.isFinite(dxPx) ? dxPx : 0;
  const dy = Number.isFinite(dyPx) ? dyPx : 0;
  return fromPixels(
    clamp(Math.round(left + dx), 0, width - side),
    clamp(Math.round(top + dy), 0, height - side),
    side,
    width,
    height,
  );
}

/** Resize the square to `side` pixels about its centre, within the picture and not under the minimum. */
export function zoomFrame(frame: Frame, side: number, width: number, height: number): Frame {
  const current = framePixels(frame, width, height);
  const shorter = Math.min(width, height);
  const wanted = Number.isFinite(side) ? Math.round(side) : current.side;
  const next = clamp(wanted, Math.min(MIN_FRAME_PX, shorter), shorter);
  const cx = current.left + current.side / 2;
  const cy = current.top + current.side / 2;
  return fromPixels(
    clamp(Math.round(cx - next / 2), 0, width - next),
    clamp(Math.round(cy - next / 2), 0, height - next),
    next,
    width,
    height,
  );
}
