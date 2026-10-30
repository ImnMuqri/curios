import { describe, expect, it } from 'vitest';
import {
  frameProblem,
  framePixels,
  fullFrame,
  moveFrame,
  TOO_SMALL_SENTENCE,
  zoomFrame,
} from './item-photos.js';

describe('item photo frame', () => {
  it('fullFrame is the largest centred square', () => {
    expect(fullFrame(800, 600)).toEqual({ x: 0.125, y: 0, size: 1 });
    expect(framePixels(fullFrame(800, 600), 800, 600)).toEqual({ left: 100, top: 0, side: 600 });
    expect(framePixels(fullFrame(600, 800), 600, 800)).toEqual({ left: 0, top: 100, side: 600 });
  });
  it('frameProblem refuses a square outside the picture, a side under 200px, and non-finite numbers', () => {
    expect(frameProblem({ x: 0.5, y: 0, size: 1 }, 800, 600)).toMatch(/inside the picture/);
    expect(frameProblem({ x: 0, y: 0, size: 0.3 }, 800, 600)).toMatch(/200 pixels/); // 180px
    expect(frameProblem({ x: Number.NaN, y: 0, size: 1 }, 800, 600)).not.toBeNull();
    expect(frameProblem({ x: 0, y: 0, size: 0 }, 800, 600)).not.toBeNull();
    expect(frameProblem({ x: 0, y: 0, size: 1.5 }, 800, 600)).not.toBeNull();
    expect(frameProblem(fullFrame(150, 150), 150, 150)).toBe(TOO_SMALL_SENTENCE);
    expect(frameProblem({ x: 0.25, y: 0, size: 0.5 }, 800, 600)).toBeNull();
    expect(frameProblem(fullFrame(800, 600), 800, 600)).toBeNull();
  });
  it('moveFrame stops at the edges; zoomFrame keeps the centre and the 200px floor', () => {
    const f = { x: 0.25, y: 0.25, size: 0.5 }; // 300px square at 200,150 on 800x600
    expect(framePixels(moveFrame(f, 10_000, -10_000, 800, 600), 800, 600)).toEqual({ left: 500, top: 0, side: 300 });
    expect(framePixels(zoomFrame(f, 100, 800, 600), 800, 600)).toEqual({ left: 250, top: 200, side: 200 });
    expect(framePixels(zoomFrame(f, 5_000, 800, 600), 800, 600).side).toBe(600);
  });
  it('moved and zoomed frames pass frameProblem', () => {
    const f = { x: 0.25, y: 0.25, size: 0.5 };
    expect(frameProblem(moveFrame(f, 10_000, 10_000, 800, 600), 800, 600)).toBeNull();
    expect(frameProblem(zoomFrame(f, 5_000, 800, 600), 800, 600)).toBeNull();
    expect(frameProblem(zoomFrame(f, 1, 800, 600), 800, 600)).toBeNull();
  });
});
