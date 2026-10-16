import { ImageResponse } from 'next/og';
import { BRAND } from './brand-colors.js';
import { COPY, type Locale } from './copy.js';
import { PERSONAS } from './personas.js';

export const OG_SIZE = { width: 1200, height: 630 };

/**
 * The share card: the headline on the left, and the product doing the thing
 * on the right -- Aisyah's page, asked a question and answering it, in her
 * page's colours. A link shared on WhatsApp looks like where it leads.
 */
export function ogImage(locale: Locale) {
  const copy = COPY[locale];
  const person = PERSONAS.aisyah;
  const qa = copy.personas.aisyah;
  return new ImageResponse(
    (
      <div style={{ display: 'flex', width: '100%', height: '100%', background: BRAND.paper, color: BRAND.ink, padding: 64, fontFamily: 'sans-serif' }}>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', width: 600 }}>
          <div style={{ display: 'flex', fontSize: 40, fontWeight: 700, letterSpacing: -1 }}>curios</div>
          <div style={{ display: 'flex', fontSize: 64, fontWeight: 700, lineHeight: 1.05, letterSpacing: -2 }}>{copy.hero.title}</div>
          <div style={{ display: 'flex', fontSize: 26, color: BRAND.muted }}>curios.my</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', marginLeft: 48, width: 424, padding: 28, borderRadius: 32, background: person.deep }}>
          <div style={{ display: 'flex', fontSize: 30, fontWeight: 700, color: BRAND.paper, marginBottom: 'auto' }}>{person.name}</div>
          <div style={{ display: 'flex', alignSelf: 'flex-end', maxWidth: 320, padding: '12px 16px', borderRadius: 14, background: BRAND.card, fontSize: 22 }}>{qa.q}</div>
          <div style={{ display: 'flex', maxWidth: 320, marginTop: 12, padding: '12px 16px', borderRadius: 14, background: person.warm, fontSize: 22 }}>{qa.a}</div>
        </div>
      </div>
    ),
    OG_SIZE,
  );
}
