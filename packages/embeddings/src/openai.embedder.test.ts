import { describe, expect, it, vi } from 'vitest';
import {
  createOpenAiEmbedder,
  EMBED_BATCH,
  EMBEDDING_BATCH_TIMEOUT_MS,
  EMBEDDING_DIMS,
  EMBEDDING_MODEL,
  EMBEDDING_TIMEOUT_MS,
} from './openai.embedder.js';

function vector(fill: number): number[] {
  return Array.from({ length: EMBEDDING_DIMS }, () => fill);
}

/** A fetch that answers with `data` in whatever order the test wants. */
function fetchReturning(data: { index: number; embedding: number[] }[]) {
  return vi.fn(async (_url: string, _init?: RequestInit) =>
    new Response(
      JSON.stringify({
        object: 'list',
        model: EMBEDDING_MODEL,
        data: data.map((d) => ({ object: 'embedding', ...d })),
        usage: { prompt_tokens: 9, total_tokens: 9 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ),
  );
}

describe('createOpenAiEmbedder', () => {
  it('asks for the model and dimensions this product stores', async () => {
    const fetchImpl = fetchReturning([{ index: 0, embedding: vector(0.1) }]);
    const embedder = createOpenAiEmbedder('k', { fetchImpl: fetchImpl as unknown as typeof fetch });

    await embedder.embed(['berapa harga']);

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/embeddings');
    expect(JSON.parse(init.body as string)).toEqual({
      model: EMBEDDING_MODEL,
      input: ['berapa harga'],
      dimensions: EMBEDDING_DIMS,
      encoding_format: 'float',
    });
  });

  it('sends the key as a bearer token', async () => {
    const fetchImpl = fetchReturning([{ index: 0, embedding: vector(0.1) }]);
    const embedder = createOpenAiEmbedder('sekret', { fetchImpl: fetchImpl as unknown as typeof fetch });

    await embedder.embed(['a']);

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer sekret');
  });

  // The response is documented as carrying an index, not as arriving in
  // order. Out of order and unsorted, every fact on a page gets another
  // fact's vector -- and nothing downstream can tell, because the numbers
  // are all still plausible vectors.
  it('returns vectors in request order, not response order', async () => {
    const fetchImpl = fetchReturning([
      { index: 1, embedding: vector(0.2) },
      { index: 0, embedding: vector(0.1) },
    ]);
    const embedder = createOpenAiEmbedder('k', { fetchImpl: fetchImpl as unknown as typeof fetch });

    const [first, second] = await embedder.embed(['first', 'second']);

    expect(first?.[0]).toBeCloseTo(0.1);
    expect(second?.[0]).toBeCloseTo(0.2);
  });

  it('throws when the provider answers with fewer vectors than texts', async () => {
    const fetchImpl = fetchReturning([{ index: 0, embedding: vector(0.1) }]);
    const embedder = createOpenAiEmbedder('k', { fetchImpl: fetchImpl as unknown as typeof fetch });

    await expect(embedder.embed(['one', 'two'])).rejects.toThrow(/2 vectors/);
  });

  it('throws when a vector is not the width this product stores', async () => {
    const fetchImpl = fetchReturning([{ index: 0, embedding: [0.1, 0.2] }]);
    const embedder = createOpenAiEmbedder('k', { fetchImpl: fetchImpl as unknown as typeof fetch });

    await expect(embedder.embed(['one'])).rejects.toThrow(/512/);
  });

  it('throws on a non-200, naming the status', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => new Response('nope', { status: 429 }));
    const embedder = createOpenAiEmbedder('k', { fetchImpl: fetchImpl as unknown as typeof fetch });

    await expect(embedder.embed(['one'])).rejects.toThrow(/429/);
  });

  // Nothing is sent, and no error is raised: an empty batch is a normal
  // state (a page where every fact already has a current vector) and paying
  // for a round trip to learn that would be silly.
  it('makes no call for an empty list', async () => {
    const fetchImpl = fetchReturning([]);
    const embedder = createOpenAiEmbedder('k', { fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(await embedder.embed([])).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('gives up after the timeout it was built with', async () => {
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        });
      }),
    );
    const embedder = createOpenAiEmbedder('k', {
      timeoutMs: 20,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(embedder.embed(['slow'])).rejects.toThrow();
  });

  it('reports the model and dimensions it writes, so a stored row can be checked against them', () => {
    const embedder = createOpenAiEmbedder('k');
    expect(embedder.model).toBe(EMBEDDING_MODEL);
    expect(embedder.dims).toBe(EMBEDDING_DIMS);
  });

  // Array.prototype.map skips holes: building the result array as
  // `new Array<Float32Array | undefined>(texts.length)` and returning
  // `vectors.map(...)` would let a response that writes two entries to the
  // same index (and none to another) sail through the length check --
  // `data.length === texts.length` -- and then `.map` silently skips the
  // hole it left behind instead of running the "skipped text" check against
  // it, returning an array one entry short of what was asked for.
  it('throws when the provider repeats one index and skips another', async () => {
    const fetchImpl = fetchReturning([
      { index: 0, embedding: vector(0.1) },
      { index: 0, embedding: vector(0.2) },
    ]);
    const embedder = createOpenAiEmbedder('k', { fetchImpl: fetchImpl as unknown as typeof fetch });

    await expect(embedder.embed(['one', 'two'])).rejects.toThrow(/skipped/);
  });

  // The requests-in-order test above checks EMBEDDING_DIMS only by round
  // trip through the embedder that already carries it, and the batch
  // constants are never read by production code in this package at all --
  // both `EMBED_BATCH` and `EMBEDDING_BATCH_TIMEOUT_MS` exist only for Task
  // 4 and the worker to import. Nothing before this pins any of the five
  // literal values the global constraints table hands to downstream tasks,
  // so an edit to any one of them would pass this whole suite silently and
  // surface only as a puzzling mismatch in a different package.
  it('locks the literal values downstream tasks are built against', () => {
    expect(EMBEDDING_MODEL).toBe('text-embedding-3-small');
    expect(EMBEDDING_DIMS).toBe(512);
    expect(EMBEDDING_TIMEOUT_MS).toBe(1000);
    expect(EMBEDDING_BATCH_TIMEOUT_MS).toBe(30_000);
    expect(EMBED_BATCH).toBe(200);
  });
});
