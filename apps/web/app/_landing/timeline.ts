/**
 * When things happen in the two pinned moments, as fractions of their scroll
 * (0 at the top of the section, 1 at its end). One place to tune the pace; the
 * scenes and their CSS only read these.
 */
export const HERO_TIMELINE = {
  bubblesFrom: 0.12,
  bubblesTo: 0.45,
  flyFrom: 0.45,
  flyTo: 0.7,
  answerFrom: 0.7,
  answerTo: 0.85,
  /** Where captions 1, 2 and 3 begin. */
  captions: [0, 0.15, 0.71],
} as const;

/** Where each of the paid moment's five steps begins. */
export const PAID_TIMELINE = { steps: [0, 0.2, 0.4, 0.6, 0.8] } as const;

const clamp = (p: number) => Math.min(1, Math.max(0, p));

/** How many times the one question has been asked at this point of the hero. */
export function heroAsked(p: number, total: number): number {
  const t = (clamp(p) - HERO_TIMELINE.flyFrom) / (HERO_TIMELINE.flyTo - HERO_TIMELINE.flyFrom);
  return Math.round(total * Math.min(1, Math.max(0, t)));
}

/** The index of the caption showing at p: the last one whose start has been passed. */
export function captionAt(p: number, starts: readonly number[]): number {
  const at = clamp(p);
  let index = 0;
  starts.forEach((start, i) => {
    if (at >= start) index = i;
  });
  return index;
}

export function paidStepAt(p: number): 1 | 2 | 3 | 4 | 5 {
  return (captionAt(p, PAID_TIMELINE.steps) + 1) as 1 | 2 | 3 | 4 | 5;
}
