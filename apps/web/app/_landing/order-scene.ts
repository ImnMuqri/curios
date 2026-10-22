/**
 * The For business section's little film, as a function of progress `p` from
 * 0 to 1: a customer taps two cakes into the basket, checks out, picks online
 * banking and Maybank2u, approves in the bank and comes straight back; the
 * order flies across and lands in the owner's Orders, already paid, to be
 * marked completed. Ported from the TanyaJe board's `ofVals` and `ofDriver`,
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

/** Where each of the five steps starts, as progress, and how long each takes. */
export const STEP_STARTS = [0, 0.24, 0.5, 0.64, 0.76, 1];
export const STEP_MS = [3800, 4600, 4800, 2600, 4000];
/** How long the finished frame is held before the film starts over. */
export const HOLD_MS = 2600;

export function stepOf(p: number): number {
  return p < 0.24 ? 0 : p < 0.5 ? 1 : p < 0.64 ? 2 : p < 0.76 ? 3 : 4;
}

/** How far through step `i` the film is, 0-100. */
export function stepProgress(p: number, i: number): number {
  const a = STEP_STARTS[i]!;
  const b = STEP_STARTS[i + 1]!;
  return Math.max(0, Math.min(100, ((p - a) / (b - a)) * 100));
}

/** Progress after `dt` ms: each step runs at its own pace. */
export function advance(p: number, dt: number): number {
  const i = stepOf(p);
  return p + (dt * (STEP_STARTS[i + 1]! - STEP_STARTS[i]!)) / STEP_MS[i]!;
}

/**
 * Where a click on step `i` jumps to: just inside it. Step 3 waits for the
 * pay sheet (.505), so a jump never shows the checkout form under its caption.
 */
export function stepStart(i: number): number {
  return Math.max(STEP_STARTS[i]! + 0.0005, i === 2 ? 0.506 : 0);
}

const NAME = 'Mira';
const PHONE = '012-345 6789';
const CLICKS = [0.09, 0.12, 0.19, 0.26, 0.465, 0.505, 0.53, 0.55, 0.572];
const TONES = ['var(--tj-card-rose)', 'var(--tj-card-latte)', 'var(--tj-blob-pink)', 'var(--tj-card-cocoa)'];
const TAPS = [[0.09, 0.12], [0.19], [], []];

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
  /** Online banking is picked and the bank list is showing. */
  wayPicked: boolean;
  /** Maybank2u is picked: the button names it. */
  bankPicked: boolean;
  /** The hand-off to the bank is on screen. */
  chip: boolean;
  approved: boolean;
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
  paidCount: number;
  completed: boolean;
  owner: { x: number; y: number; o: number; pressed: boolean };
}

export function scene(p: number): OrderScene {
  const seg = (a: number, b: number) => clamp((p - a) / (b - a));
  const near = (ts: number[]) => ts.some((t) => p >= t && p < t + 0.012);

  const [cx, cy] = path(p, [
    [0, 200, 470], [0.05, 123, 301], [0.13, 123, 301], [0.17, 261, 301], [0.2, 261, 301], [0.24, 234, 564],
    [0.27, 234, 564], [0.31, 150, 257], [0.36, 150, 257], [0.37, 150, 325], [0.44, 150, 325], [0.46, 86, 381],
    [0.48, 86, 381], [0.5, 150, 552], [0.51, 150, 552], [0.522, 150, 245], [0.535, 150, 245], [0.543, 84, 452],
    [0.556, 84, 452], [0.566, 150, 552], [0.578, 150, 552], [0.6, 230, 480], [0.66, 230, 480],
  ]);
  const cakes = p >= 0.12 ? 2 : p >= 0.09 ? 1 : 0;
  const batik = p >= 0.19 ? 1 : 0;
  const t = seg(0.7, 0.78);
  const burstT = seg(0.665, 0.72);
  const [ox, oy] = path(p, [[0.86, 200, 540], [0.91, 140, 330]]);
  const completed = p >= 0.93;
  const inserted = ease(seg(0.78, 0.84));

  return {
    step: stepOf(p),
    rows: TONES.map((tone, i) => ({
      qty: i === 0 ? cakes : i === 1 ? batik : 0,
      pressed: near(TAPS[i]!),
      tone,
    })),
    basketCount: cakes + batik,
    basketTotal: cakes * 95 + batik * 45,
    sheet: 100 * ease(seg(0.26, 0.3)),
    view: p < 0.505 ? 'form' : 'pay',
    name: NAME.slice(0, Math.round(seg(0.32, 0.355) * NAME.length)),
    nameFocused: p >= 0.31 && p < 0.365,
    phone: PHONE.slice(0, Math.round(seg(0.375, 0.435) * PHONE.length)),
    phoneFocused: p >= 0.37 && p < 0.445,
    pickup: p >= 0.465,
    wayPicked: p >= 0.53,
    bankPicked: p >= 0.55,
    chip: p >= 0.58,
    approved: p >= 0.615,
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
    card: { inserted, ring: !completed, isNew: p >= 0.8 && !completed },
    today: 480 + Math.round(235 * ease(seg(0.8, 0.88))),
    plus: seg(0.8, 0.83),
    paidCount: p >= 0.8 && !completed ? 4 : 3,
    completed,
    owner: { x: Math.round(ox), y: Math.round(oy), o: p < 0.97 ? seg(0.86, 0.875) : 1 - seg(0.97, 0.99), pressed: p >= 0.93 && p < 0.942 },
  };
}
