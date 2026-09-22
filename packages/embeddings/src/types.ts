/**
 * The seam. Tests stub this interface, never `fetch` -- mocking the wire
 * format couples a test to OpenAI's response shape instead of our own, which
 * is the same argument `packages/gateway` makes for `Gateway`.
 *
 * `model` and `dims` are on the interface rather than imported as constants
 * by every caller, because what matters at each call site is what THIS
 * embedder writes: a stored row is only usable by an embedder that agrees
 * with it, and the comparison should be against the object doing the work.
 */
export interface Embedder {
  readonly model: string;
  readonly dims: number;
  /**
   * One vector per text, in the order the texts were given. Rejects rather
   * than returning a short or mis-ordered array -- every caller treats a
   * rejection as "fall back", and none of them can detect a wrong vector.
   */
  embed(texts: string[]): Promise<Float32Array[]>;
}
