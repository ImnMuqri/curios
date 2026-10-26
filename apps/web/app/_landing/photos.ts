/**
 * Every photo the landing shows, with its size and the smaller copies made of it,
 * so each <img> declares its dimensions and lets the browser pick the smallest
 * copy that is still sharp. A 26 px pricing chip used to download the whole
 * 1024 px baker photo.
 *
 * A copy is `<name>-<width>.webp` beside the original, made with sharp at
 * quality 80. A new or redrawn photo needs its copies made too; a test checks
 * that every one listed here exists.
 */
export const PHOTOS: Record<string, { width: number; height: number; copies: number[] }> = {
  '/landing/hero-baker.webp': { width: 1024, height: 1536, copies: [96, 512] },
  '/landing/personas/aisyah-face.webp': { width: 256, height: 256, copies: [96] },
  '/landing/personas/aisyah.webp': { width: 700, height: 869, copies: [360] },
  '/landing/personas/hana.webp': { width: 700, height: 869, copies: [360] },
  '/landing/personas/daniel.webp': { width: 700, height: 869, copies: [360] },
  '/landing/personas/aina.webp': { width: 700, height: 869, copies: [360] },
  '/landing/personas/farah.webp': { width: 700, height: 869, copies: [360] },
};

/** The path of one smaller copy. */
export function photoCopy(src: string, width: number): string {
  return src.replace(/\.webp$/, `-${width}.webp`);
}

/**
 * The <img> attributes for a landing photo drawn `shown` CSS pixels wide. The
 * stylesheet sizes every one of them, so width and height only give the
 * browser the shape to reserve before the file arrives.
 */
export function photo(src: string, shown: number) {
  const known = PHOTOS[src];
  if (!known) throw new Error(`${src} is not in PHOTOS`);
  return {
    src,
    width: known.width,
    height: known.height,
    srcSet: [...known.copies.map((w) => `${photoCopy(src, w)} ${w}w`), `${src} ${known.width}w`].join(', '),
    sizes: `${shown}px`,
  };
}
