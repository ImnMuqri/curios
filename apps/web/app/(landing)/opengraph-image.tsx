import { COPY } from '../_landing/copy.js';
import { OG_SIZE, ogImage } from '../_landing/og-image.js';

export const alt = COPY.en.meta.ogAlt;
export const size = OG_SIZE;
export const contentType = 'image/png';

export default function Image() {
  return ogImage('en');
}
