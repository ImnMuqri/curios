/**
 * The For business section's little film, as a function of progress `p` from
 * 0 to 1: a customer taps two cakes into the basket, checks out, pays by the
 * shop's QR and uploads the receipt; the order flies across and lands in the
 * owner's Orders, who confirms it. Ported from the TanyaJe board's `ofVals`,
 * so the timings are the board's. Pure, so it can be tested frame by frame.
 */

const clamp = (v: number) => Math.max(0, Math.min(1, v));
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const back = (t: number) => {
  const c = 1.7;
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
};

/** Where a cursor is at `p`, moving between waypoints [at, x, y]. */
function path(p: number, points: [number, number, number][]): [number, number] {
  const first = points[0]!;
  if (p <= first[0]) return [first[1], first[2]];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    if (p >= a[0] && p <= b[0]) {
      const t = ease((p - a[0]) / (b[0] - a[0] || 1));
      return [a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    }
  }
  const last = points[points.length - 1]!;
  return [last[1], last[2]];
}

const NAME = 'Mira';
const PHONE = '012-345 6789';
const CLICKS = [0.09, 0.12, 0.19, 0.26, 0.465, 0.505, 0.565, 0.635];
const PRICES = [95, 45, 25, 30];
const TONES = ['var(--tj-blob-pink)', 'var(--tj-rose-200)', 'var(--tj-blob-pink)', 'var(--tj-blob-peach)'];

export interface OrderScene {
  /** Which caption is current, 0-4. */
  step: number;
  rows: { qty: number; pressed: boolean; tone: string }[];
  basketCount: number;
  basketTotal: number;
  /** How far the checkout sheet has risen, 0-100. */
  sheet: number;
  view: 'form' | 'pay';
  name: string;
  nameFocused: boolean;
  phone: string;
  phoneFocused: boolean;
  pickup: boolean;
  receipt: boolean;
  uploading: boolean;
  uploadPercent: number;
  uploaded: boolean;
  placeReady: boolean;
  success: number;
  successCircle: number;
  successCheck: number;
  burst: { x: number; y: number; r: number; o: number; c: string }[];
  cursor: { x: number; y: number; o: number; pressed: boolean };
  token: { x: number; y: number; s: number; o: number };
  notif: { y: number; o: number };
  card: { inserted: number; ring: boolean; isNew: boolean };
  today: number;
  plus: number;
  bell: boolean;
  confirmed: boolean;
  owner: { x: number; y: number; o: number; pressed: boolean };
}

export function scene(p: number): OrderScene {
  const seg = (a: number, b: number) => clamp((p - a) / (b - a));
  const near = (ts: number[]) => ts.some((t) => p >= t && p < t + 0.012);

  const [cx, cy] = path(p, [
    [0, 200, 470], [0.05, 260, 268], [0.13, 260, 268], [0.17, 260, 324], [0.2, 260, 324], [0.24, 234, 564],
    [0.27, 234, 564], [0.31, 150, 257], [0.36, 150, 257], [0.37, 150, 325], [0.44, 150, 325], [0.46, 86, 381],
    [0.48, 86, 381], [0.5, 150, 552], [0.52, 150, 552], [0.555, 150, 475], [0.58, 150, 475], [0.62, 150, 552], [0.66, 150, 552],
  ]);
  const cakes = p >= 0.12 ? 2 : p >= 0.09 ? 1 : 0;
  const batik = p >= 0.19 ? 1 : 0;
  const taps = [[0.09, 0.12], [0.19], [], []];
  const t = seg(0.7, 0.78);
  const burstT = seg(0.665, 0.72);
  const [ox, oy] = path(p, [[0.86, 200, 540], [0.91, 132, 366]]);
  const confirmed = p >= 0.93;
  const inserted = ease(seg(0.78, 0.84));

  return {
    step: p < 0.24 ? 0 : p < 0.5 ? 1 : p < 0.64 ? 2 : p < 0.76 ? 3 : 4,
    rows: PRICES.map((_, i) => ({
      qty: i === 0 ? cakes : i === 1 ? batik : 0,
      pressed: taps[i]!.some((x) => p >= x && p < x + 0.012),
      tone: TONES[i]!,
    })),
    basketCount: cakes + batik,
    basketTotal: cakes * PRICES[0]! + batik * PRICES[1]!,
    sheet: 100 * ease(seg(0.26, 0.3)),
    view: p < 0.505 ? 'form' : 'pay',
    name: NAME.slice(0, Math.round(seg(0.32, 0.355) * NAME.length)),
    nameFocused: p >= 0.31 && p < 0.365,
    phone: PHONE.slice(0, Math.round(seg(0.375, 0.435) * PHONE.length)),
    phoneFocused: p >= 0.37 && p < 0.445,
    pickup: p >= 0.465,
    receipt: p >= 0.59,
    uploading: p >= 0.565,
    uploadPercent: Math.round(seg(0.565, 0.59) * 100),
    uploaded: p >= 0.59,
    placeReady: p >= 0.59,
    success: seg(0.64, 0.66),
    successCircle: back(seg(0.645, 0.668)),
    successCheck: 70 - 70 * seg(0.655, 0.685),
    burst: Array.from({ length: 12 }, (_, i) => {
      const a = (i / 12) * Math.PI * 2;
      const d = 18 + 62 * (1 - Math.pow(1 - burstT, 3));
      return {
        x: Math.round(Math.cos(a) * d),
        y: Math.round(Math.sin(a) * d),
        r: Math.round(burstT * 180 + i * 30),
        o: burstT > 0 && burstT < 1 ? 1 - burstT : 0,
        c: ['var(--tj-rose)', 'var(--biru)', 'var(--kuning)', 'var(--hijau)'][i % 4]!,
      };
    }),
    cursor: { x: Math.round(cx), y: Math.round(cy), o: p < 0.66 ? seg(0, 0.02) : 1 - seg(0.66, 0.68), pressed: near(CLICKS) },
    token: {
      x: Math.round(362 * t),
      y: Math.round(-60 * t - 130 * Math.sin(Math.PI * t)),
      s: 1 - 0.3 * t,
      o: t > 0 && t < 1 ? (t < 0.1 ? t * 10 : t > 0.9 ? (1 - t) * 10 : 1) : 0,
    },
    notif: {
      y: p < 0.76 ? -130 : p < 0.78 ? Math.round(-130 + 130 * ease(seg(0.76, 0.78))) : p < 0.82 ? 0 : Math.round(-130 * ease(seg(0.82, 0.84))),
      o: p >= 0.76 && p < 0.84 ? 1 : 0,
    },
    card: { inserted, ring: !confirmed, isNew: p >= 0.8 && !confirmed },
    today: 80 + Math.round(235 * ease(seg(0.8, 0.88))),
    plus: seg(0.8, 0.83),
    bell: p >= 0.78 && !confirmed,
    confirmed,
    owner: { x: Math.round(ox), y: Math.round(oy), o: p < 0.97 ? seg(0.86, 0.875) : 1 - seg(0.97, 0.99), pressed: p >= 0.93 && p < 0.942 },
  };
}
