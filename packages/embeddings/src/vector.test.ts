import { describe, expect, it } from 'vitest';
import { decodeVector, encodeVector } from './vector.js';

describe('encodeVector / decodeVector', () => {
  it('round-trips a vector through bytes', () => {
    const original = Float32Array.from([0.5, -0.25, 0, 1]);
    const decoded = decodeVector(encodeVector(original), 4);
    expect(Array.from(decoded)).toEqual([0.5, -0.25, 0, 1]);
  });

  it('writes four bytes per dimension', () => {
    expect(encodeVector([1, 2, 3]).byteLength).toBe(12);
  });

  // Little-endian explicitly, not "whatever this machine does". These bytes
  // outlive the process that wrote them and may be read by another machine.
  it('writes little-endian', () => {
    // 1.0 as IEEE-754 single precision is 0x3F800000; little-endian puts the
    // low byte first.
    expect(Array.from(encodeVector([1]))).toEqual([0x00, 0x00, 0x80, 0x3f]);
  });

  // The bug this guards is the reason decodeVector takes byteOffset into
  // account: Node allocates small Buffers as views into a shared pool, so
  // `bytes.buffer` is the whole pool and a decode that ignores byteOffset
  // reads somebody else's memory. Simulated here with a deliberate view.
  it('decodes a view that does not start at byte zero', () => {
    const pool = new Uint8Array(64);
    const view = new Uint8Array(pool.buffer, 16, 8);
    view.set(encodeVector([2.5, -2.5]));
    expect(Array.from(decodeVector(view, 2))).toEqual([2.5, -2.5]);
  });

  it('refuses bytes whose length does not match the dimensions', () => {
    expect(() => decodeVector(encodeVector([1, 2, 3]), 4)).toThrow(/12 bytes/);
  });
});
