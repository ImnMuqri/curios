/**
 * What lands in your hands (Landing2 board, L2:1080–1104): the script each
 * side plays, its timing, and which side comes next. Pure data; the words
 * live in copy.ts and the run lives in Lands.tsx.
 */

export type Side = 'service' | 'products';

/** A product or package card in the chat, and on the suggestions zone. */
export interface LandsCard {
  /** A key of SWATCHES in personas.ts: the owner's own product photo, drawn as a gradient. */
  swatch: string;
  name: string;
  price: string;
}

export type LandsLine =
  | { r: 'v'; t: string; step?: number; pick?: number }
  | { r: 'p'; t: string; step?: number; cards?: LandsCard[]; capture?: string; land?: number[] }
  | { r: 'add'; i: number; step: number }
  | { r: 'checkout'; step: number }
  | { r: 'pay'; step: number }
  | { r: 'end'; step: number; land: number[] };

export const TIMING = {
  start: 700,
  typeChar: 22,
  beforeSend: 240,
  press: 150,
  afterVisitor: 500,
  pickHold: 500,
  dots: 850,
  word: 45,
  cardsHold: 700,
  captureIn: 400,
  captureWait: 1100,
  captureChar: 55,
  captureBeforeSend: 300,
  capturePress: 170,
  captureAfterPress: 350,
  captureSent: 600,
  afterPage: 500,
  dot: 650,
  betweenLands: 380,
  bump: 900,
  endHappy: 1900,
  hold: 4600,
  addWait: 400,
  addPress: 170,
  basketIn: 300,
  basketHold: 1100,
  toCheckout: 200,
  sheetIn: 900,
  scroll: 750,
  select: 600,
  fieldChar: 55,
  fieldGap: 250,
  banksIn: 700,
  payPress: 180,
  paying: 1400,
  paidHold: 1300,
} as const;

/** After a run: alternate sides on its own, or stay on the side a visitor picked. */
export function nextSide(current: Side, userChose: boolean): Side {
  if (userChose) return current;
  return current === 'service' ? 'products' : 'service';
}
