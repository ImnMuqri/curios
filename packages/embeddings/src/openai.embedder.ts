import type { Embedder } from './types.js';

/**
 * The embedding model, by name, and stored on every row it writes.
 *
 * A change here must change the stored `model` value too, which is what makes
 * the switch safe: the chat path only reads vectors whose model and width
 * match the embedder it holds, so the day this constant changes every page
 * falls back to sending every fact until a backfill catches up. Slow and
 * expensive, never wrong.
 */
export const EMBEDDING_MODEL = 'text-embedding-3-small';

/**
 * 512 of the model's native 1,536.
 *
 * The API shortens and re-normalises server-side, so this is not a truncation
 * we have to correct for. Every question scores against every vector on the
 * page, so width is read work on the hot path: 512 floats is 2KB a fact, and
 * a 120-fact page is a quarter of a megabyte a question -- a few milliseconds
 * against a local Postgres, and a third of what the full width would cost.
 */
export const EMBEDDING_DIMS = 512;

/**
 * The visitor path's timeout. A visitor is watching a blank bubble, and an
 * answer built from every fact is a correct answer -- waiting longer than
 * this to make it a cheaper one is the wrong trade.
 */
export const EMBEDDING_TIMEOUT_MS = 1000;

/** Batches: the worker and the backfill, where nobody is waiting. */
export const EMBEDDING_BATCH_TIMEOUT_MS = 30_000;

/**
 * Texts per request. The endpoint allows 2,048 and 300,000 tokens across the
 * request; 200 short claims is nowhere near either, and keeps one failed
 * request from costing a whole large page.
 */
export const EMBED_BATCH = 200;

const ENDPOINT = 'https://api.openai.com/v1/embeddings';

interface EmbeddingResponse {
  data?: { index?: number; embedding?: number[] }[];
}

/**
 * `fetch`, not the OpenAI SDK.
 *
 * One endpoint, one request shape, one response shape. The SDK would add a
 * dependency and an abstraction over twenty lines, and `AbortSignal.timeout`
 * is the clean way to hold the visitor path to a deadline. `fetchImpl` is the
 * test seam; production never passes it.
 *
 * There are no retries, deliberately. Every caller's failure path is "send
 * every fact", which is correct and already built -- a retry would double a
 * visitor's wait to save a fraction of a sen.
 */
export function createOpenAiEmbedder(
  apiKey: string,
  options: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Embedder {
  const timeoutMs = options.timeoutMs ?? EMBEDDING_TIMEOUT_MS;
  const call = options.fetchImpl ?? fetch;

  return {
    model: EMBEDDING_MODEL,
    dims: EMBEDDING_DIMS,

    async embed(texts: string[]): Promise<Float32Array[]> {
      // A page where every fact already carries a current vector asks for
      // nothing, and a round trip to be told so costs real time on the
      // visitor path.
      if (texts.length === 0) return [];

      const response = await call(ENDPOINT, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: EMBEDDING_MODEL,
          input: texts,
          dimensions: EMBEDDING_DIMS,
          encoding_format: 'float',
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!response.ok) {
        // The body is not read: it may carry the key back in an error echo,
        // and this message reaches logs. The status is what a reader needs.
        throw new Error(`The embeddings provider answered ${response.status}.`);
      }

      const body = (await response.json()) as EmbeddingResponse;
      const data = body.data ?? [];
      if (data.length !== texts.length) {
        throw new Error(
          `Asked for ${texts.length} vectors and got ${data.length}. Nothing is embedded.`,
        );
      }

      // Placed by `index`, never by arrival order. The response is documented
      // to carry the index and not to preserve order, and a silently
      // shuffled batch gives every fact on a page somebody else's vector --
      // wrong answers that look exactly like a model that is bad at Malay.
      const vectors = new Array<Float32Array | undefined>(texts.length);
      for (const item of data) {
        const index = item.index;
        const embedding = item.embedding;
        if (index === undefined || embedding === undefined || index >= texts.length) {
          throw new Error('The embeddings provider answered with an unusable entry.');
        }
        if (embedding.length !== EMBEDDING_DIMS) {
          throw new Error(
            `Expected ${EMBEDDING_DIMS} dimensions and got ${embedding.length}.`,
          );
        }
        vectors[index] = Float32Array.from(embedding);
      }

      // `Array.from`, not `vectors.map`: `.map` skips holes, so a response
      // that writes two entries to the same index (and none to another)
      // would still pass the length check above and then have its hole
      // silently skipped by `.map`, returning an array one entry short
      // instead of raising the "skipped text" error below. `Array.from`
      // visits every index, hole or not, calling the mapper with
      // `undefined` for the ones `data` never wrote.
      return Array.from(vectors, (vector, index) => {
        if (vector === undefined) {
          throw new Error(`The embeddings provider skipped text ${index}.`);
        }
        return vector;
      });
    },
  };
}
