import sharp from 'sharp';

/**
 * The colours at the top and the foot of a cover photo, as six-digit hex. The shop wears its cover
 * blurred behind the whole column, filling it (`object-fit: cover`), so on a phone what shows is the
 * middle of the photo top to bottom: each colour is the average of the middle half of its width, over
 * the top or bottom fifth. The page paints the browser's bars in them (DocumentColor), so the strips
 * behind a phone's status bar and toolbar follow the photo rather than the page's plain colour.
 */
export interface CoverTint {
  top: string;
  bottom: string;
}

const hex = (channels: { mean: number }[]) =>
  `#${channels
    .slice(0, 3)
    .map((c) => Math.round(c.mean).toString(16).padStart(2, '0'))
    .join('')}`;

/** Null when the picture cannot be read: the page then keeps its own colour, as it always did. */
export async function coverTint(picture: Buffer): Promise<CoverTint | null> {
  try {
    const image = sharp(picture).rotate();
    const { width = 0, height = 0 } = await image.metadata();
    if (width < 4 || height < 5) return null;
    const left = Math.floor(width / 4);
    const band = { left, width: Math.max(1, width - 2 * left), height: Math.max(1, Math.floor(height / 5)) };
    // Cropped to a buffer first: `stats()` measures the picture it is given, not the pipeline's crop.
    const average = async (top: number) =>
      hex((await sharp(await sharp(picture).rotate().extract({ ...band, top }).removeAlpha().png().toBuffer()).stats()).channels);
    return { top: await average(0), bottom: await average(height - band.height) };
  } catch {
    return null;
  }
}
