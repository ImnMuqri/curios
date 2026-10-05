import { ImageResponse } from 'next/og';
import { BRAND } from './_landing/brand-colors.js';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

/** The favicon's mark at home-screen size: the ask bar's stamped field, on biru. */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', background: BRAND.biru }}>
        <div style={{ display: 'flex', alignItems: 'center', width: 118, height: 56, paddingLeft: 18, borderRadius: 16, border: `11px solid ${BRAND.paper}` }}>
          <div style={{ width: 11, height: 18, borderRadius: 5, background: BRAND.paper }} />
        </div>
      </div>
    ),
    size,
  );
}
