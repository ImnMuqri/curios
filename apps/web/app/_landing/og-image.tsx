import { ImageResponse } from 'next/og';
import { BRAND } from './brand-colors.js';
import { COPY, type Locale } from './copy.js';
import { DEMO_SHOP } from './demo.js';

export const OG_SIZE = { width: 1200, height: 630 };

/**
 * The share card: the promise on the left, and the product doing the thing on
 * the right -- the demo shop's ask bar with its question and answer. Drawn
 * with the same palette as the page, so a link shared on WhatsApp looks like
 * where it leads.
 */
export function ogImage(locale: Locale) {
  const copy = COPY[locale];
  const DEMO_QA = copy.shop.qa;
  const qa = DEMO_QA[0]!;
  return new ImageResponse(
    (
      <div style={{ display: 'flex', width: '100%', height: '100%', background: BRAND.paper, color: BRAND.ink, padding: 64, fontFamily: 'sans-serif' }}>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', width: 600 }}>
          <div style={{ display: 'flex', fontSize: 40, fontWeight: 700, letterSpacing: -1 }}>curios</div>
          <div style={{ display: 'flex', fontSize: 64, fontWeight: 700, lineHeight: 1.05, letterSpacing: -2 }}>{copy.hero.title}</div>
          <div style={{ display: 'flex', fontSize: 26, color: BRAND.muted }}>curios.my</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', marginLeft: 48, width: 424, padding: 28, borderRadius: 32, background: BRAND.ink }}>
          <div style={{ display: 'flex', fontSize: 30, fontWeight: 700, color: BRAND.paper, marginBottom: 'auto' }}>{DEMO_SHOP}</div>
          <div style={{ display: 'flex', alignSelf: 'flex-end', maxWidth: 320, padding: '12px 16px', borderRadius: 14, background: BRAND.card, fontSize: 22 }}>{qa.q}</div>
          <div style={{ display: 'flex', maxWidth: 320, marginTop: 12, padding: '12px 16px', borderRadius: 14, background: BRAND.biruMuda, fontSize: 22 }}>{qa.a}</div>
        </div>
      </div>
    ),
    OG_SIZE,
  );
}
