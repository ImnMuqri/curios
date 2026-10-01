import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { EMBEDDING_DIMS, EMBEDDING_MODEL, type Embedder } from '@curios/embeddings';
import type { Gateway, SameQuestionInput } from '@curios/gateway';
import { runGroupJob } from './group.job.js';

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_TEST } } });

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE "Account", "ModelCall", "QuestionEmbedding" CASCADE');
});
afterAll(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE "Account", "ModelCall", "QuestionEmbedding" CASCADE');
  await prisma.$disconnect();
});

/** Unit vectors chosen per text: texts sharing a "direction" are similar. */
function embedderFor(directions: Record<string, number>): Embedder {
  return {
    model: EMBEDDING_MODEL,
    dims: EMBEDDING_DIMS,
    embed: async (texts) =>
      texts.map((text) => {
        const v = new Float32Array(EMBEDDING_DIMS);
        v[directions[text] ?? 999] = 1;
        return v;
      }),
  };
}

function gatewaySaying(verdict: (input: SameQuestionInput) => string | null) {
  const calls: SameQuestionInput[] = [];
  const gateway = {
    sameQuestion: async (input: SameQuestionInput) => {
      calls.push(input);
      return { match: verdict(input), usage: { inputTokens: 10, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 }, model: 'claude-haiku-4-5', latencyMs: 5 };
    },
  } as unknown as Gateway;
  return { gateway, calls };
}

let n = 0;
async function aPage() {
  n += 1;
  const account = await prisma.account.create({
    data: { email: `g${n}@example.com`, pages: { create: { handle: `g${n}`, skeleton: `g${n}`, displayName: 'Iman Muqri', mode: 'PERSONAL' } } },
    include: { pages: true },
  });
  return account.pages[0]!.id;
}

async function aWording(pageId: string, text: string, opts: { grouped?: boolean; askCount?: number; answer?: string; pinned?: boolean } = {}) {
  const topic = await prisma.topic.create({ data: { pageId, title: text, askCount: opts.askCount ?? 1, answer: opts.answer ?? null } });
  return prisma.question.create({
    data: {
      pageId, topicId: topic.id, text, normalizedQuestion: text.toLowerCase(), askCount: opts.askCount ?? 1,
      groupedAt: opts.grouped ? new Date() : null, pinnedByOwner: opts.pinned ?? false,
    },
  });
}

describe('runGroupJob', () => {
  it('leaves a wording alone, with no model call, when nothing is close', async () => {
    const pageId = await aPage();
    await aWording(pageId, 'Kek berapa', { grouped: true });
    const q = await aWording(pageId, 'Who is Iman');
    const { gateway, calls } = gatewaySaying(() => null);
    const embedder = embedderFor({ 'Kek berapa': 1, 'Who is Iman': 2 });

    await expect(runGroupJob({ prisma, gateway, embedder }, { questionId: q.id })).resolves.toBe('alone');
    expect(calls).toHaveLength(0);
    expect((await prisma.question.findUniqueOrThrow({ where: { id: q.id } })).groupedAt).not.toBeNull();
  });

  it('merges into the topic the model names, and records the call', async () => {
    const pageId = await aPage();
    const target = await aWording(pageId, "What is Iman's full name", { grouped: true, askCount: 4, answer: 'Iman Muqri' });
    const q = await aWording(pageId, 'What is his full name', { askCount: 2 });
    const { gateway, calls } = gatewaySaying((input) => input.candidates[0]!.id);
    const embedder = embedderFor({ "What is Iman's full name": 1, 'What is his full name': 1 });

    await expect(runGroupJob({ prisma, gateway, embedder }, { questionId: q.id })).resolves.toBe('merged');
    const moved = await prisma.question.findUniqueOrThrow({ where: { id: q.id } });
    expect(moved.topicId).toBe(target.topicId);
    expect(moved.groupedAt).not.toBeNull();
    expect(await prisma.topic.findUniqueOrThrow({ where: { id: target.topicId } })).toMatchObject({ askCount: 6, answer: 'Iman Muqri' });
    expect(calls[0]).toMatchObject({ pageName: 'Iman Muqri', mode: 'PERSONAL', wording: 'What is his full name' });
    expect(await prisma.modelCall.count({ where: { pageId } })).toBe(1);
  });

  it('moves nothing when the model says none', async () => {
    const pageId = await aPage();
    const other = await aWording(pageId, 'Kek 1kg berapa', { grouped: true });
    const q = await aWording(pageId, 'Kek 2kg berapa');
    const { gateway } = gatewaySaying(() => null);
    const embedder = embedderFor({ 'Kek 1kg berapa': 1, 'Kek 2kg berapa': 1 });

    await expect(runGroupJob({ prisma, gateway, embedder }, { questionId: q.id })).resolves.toBe('none');
    expect((await prisma.question.findUniqueOrThrow({ where: { id: q.id } })).topicId).not.toBe(other.topicId);
  });

  it('never moves a wording the owner split out', async () => {
    const pageId = await aPage();
    await aWording(pageId, 'a', { grouped: true });
    const q = await aWording(pageId, 'b', { pinned: true });
    const { gateway, calls } = gatewaySaying((input) => input.candidates[0]!.id);
    const embedder = embedderFor({ a: 1, b: 1 });

    await expect(runGroupJob({ prisma, gateway, embedder }, { questionId: q.id })).resolves.toBe('skipped');
    expect(calls).toHaveLength(0);
  });

  it('skips a wording already decided, and a missing one', async () => {
    const pageId = await aPage();
    const q = await aWording(pageId, 'a', { grouped: true });
    const { gateway } = gatewaySaying(() => null);
    const embedder = embedderFor({});
    await expect(runGroupJob({ prisma, gateway, embedder }, { questionId: q.id })).resolves.toBe('skipped');
    await expect(runGroupJob({ prisma, gateway, embedder }, { questionId: 'nope' })).resolves.toBe('skipped');
  });

  it('never offers another page’s topic, nor an undecided one, as a candidate', async () => {
    const pageId = await aPage();
    const otherPage = await aPage();
    await aWording(otherPage, 'twin', { grouped: true });
    await aWording(pageId, 'undecided twin');
    const q = await aWording(pageId, 'me');
    const { gateway, calls } = gatewaySaying(() => null);
    const embedder = embedderFor({ twin: 1, 'undecided twin': 1, me: 1 });

    await expect(runGroupJob({ prisma, gateway, embedder }, { questionId: q.id })).resolves.toBe('alone');
    expect(calls).toHaveLength(0);
  });

  it('offers at most three candidates, closest first', async () => {
    const pageId = await aPage();
    for (const t of ['c1', 'c2', 'c3', 'c4']) await aWording(pageId, t, { grouped: true });
    const q = await aWording(pageId, 'me');
    const { gateway, calls } = gatewaySaying(() => null);
    // The angle from "me" grows c3 < c1 < c4 < c2; all clear the 0.7 floor, c2 is cut by the limit.
    const tilt: Record<string, number> = { c3: 0.1, c1: 0.2, c4: 0.3, c2: 0.4 };
    const embedder: Embedder = {
      model: EMBEDDING_MODEL,
      dims: EMBEDDING_DIMS,
      embed: async (texts) =>
        texts.map((text) => {
          const v = new Float32Array(EMBEDDING_DIMS);
          v[0] = 1;
          v[1] = tilt[text] ?? 0;
          return v;
        }),
    };

    await runGroupJob({ prisma, gateway, embedder }, { questionId: q.id });
    expect(calls[0]!.candidates.map((c) => c.title)).toEqual(['c3', 'c1', 'c4']);
  });

  it('embeds uncached wordings in chunks of 100', async () => {
    const pageId = await aPage();
    for (let i = 0; i < 249; i += 1) await aWording(pageId, `w${i}`, { grouped: true });
    const q = await aWording(pageId, 'me');
    const base = embedderFor({});
    const embed = vi.fn((texts: string[]) => base.embed(texts));
    const { gateway } = gatewaySaying(() => null);
    await runGroupJob({ prisma, gateway, embedder: { ...base, embed } }, { questionId: q.id });
    expect(embed.mock.calls.map(([texts]) => texts.length)).toEqual([100, 100, 50]);
  });

  describe('when the world changes while the model is answering', () => {
    /** A gateway that does something to the database, then names the first candidate. */
    function gatewayDoing(during: () => Promise<unknown>): Gateway {
      return {
        sameQuestion: async (input: SameQuestionInput) => {
          await during();
          return { match: input.candidates[0]!.id, usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 }, model: 'claude-haiku-4-5', latencyMs: 1 };
        },
      } as unknown as Gateway;
    }

    it('skips a wording the owner pinned meanwhile, even if its topic has siblings', async () => {
      const pageId = await aPage();
      await aWording(pageId, 'a', { grouped: true });
      const q = await aWording(pageId, 'b');
      await prisma.question.create({ data: { pageId, topicId: q.topicId, text: 'sib', normalizedQuestion: 'sib', groupedAt: new Date() } });
      const gateway = gatewayDoing(() => prisma.question.update({ where: { id: q.id }, data: { pinnedByOwner: true } }));

      await expect(runGroupJob({ prisma, gateway, embedder: embedderFor({ a: 1, b: 1, sib: 2 }) }, { questionId: q.id })).resolves.toBe('skipped');
      const after = await prisma.question.findUniqueOrThrow({ where: { id: q.id } });
      expect(after).toMatchObject({ topicId: q.topicId, pinnedByOwner: true, groupedAt: null });
    });

    it('skips, without throwing, a wording deleted meanwhile', async () => {
      const pageId = await aPage();
      await aWording(pageId, 'a', { grouped: true });
      const q = await aWording(pageId, 'b');
      const gateway = gatewayDoing(() => prisma.question.delete({ where: { id: q.id } }));
      await expect(runGroupJob({ prisma, gateway, embedder: embedderFor({ a: 1, b: 1 }) }, { questionId: q.id })).resolves.toBe('skipped');
    });

    it('settles on none when the matched topic is deleted meanwhile', async () => {
      const pageId = await aPage();
      const target = await aWording(pageId, 'a', { grouped: true });
      const q = await aWording(pageId, 'b');
      const gateway = gatewayDoing(async () => {
        await prisma.question.delete({ where: { id: target.id } });
        await prisma.topic.delete({ where: { id: target.topicId } });
      });
      await expect(runGroupJob({ prisma, gateway, embedder: embedderFor({ a: 1, b: 1 }) }, { questionId: q.id })).resolves.toBe('none');
      const after = await prisma.question.findUniqueOrThrow({ where: { id: q.id } });
      expect(after.topicId).toBe(q.topicId);
      expect(after.groupedAt).not.toBeNull();
    });

    it('skips a wording moved to another topic meanwhile', async () => {
      const pageId = await aPage();
      await aWording(pageId, 'a', { grouped: true });
      const q = await aWording(pageId, 'b');
      const elsewhere = await prisma.topic.create({ data: { pageId, title: 'elsewhere', askCount: 1 } });
      const gateway = gatewayDoing(() => prisma.question.update({ where: { id: q.id }, data: { topicId: elsewhere.id } }));
      await expect(runGroupJob({ prisma, gateway, embedder: embedderFor({ a: 1, b: 1 }) }, { questionId: q.id })).resolves.toBe('skipped');
      expect((await prisma.question.findUniqueOrThrow({ where: { id: q.id } })).topicId).toBe(elsewhere.id);
    });
  });

  it('moves only this wording when its topic holds others', async () => {
    const pageId = await aPage();
    const target = await aWording(pageId, 'target', { grouped: true });
    const q = await aWording(pageId, 'me');
    await prisma.question.create({ data: { pageId, topicId: q.topicId, text: 'sibling', normalizedQuestion: 'sibling', groupedAt: new Date() } });
    const { gateway } = gatewaySaying((input) => input.candidates[0]!.id);
    const embedder = embedderFor({ target: 1, me: 1, sibling: 2 });

    await expect(runGroupJob({ prisma, gateway, embedder }, { questionId: q.id })).resolves.toBe('moved');
    expect((await prisma.question.findFirstOrThrow({ where: { text: 'sibling' } })).topicId).toBe(q.topicId);
    expect((await prisma.question.findUniqueOrThrow({ where: { id: q.id } })).topicId).toBe(target.topicId);
  });

  it('leaves the wording undecided when the model call fails, so a re-run can pick it up', async () => {
    const pageId = await aPage();
    await aWording(pageId, 'a', { grouped: true });
    const q = await aWording(pageId, 'b');
    const gateway = { sameQuestion: vi.fn(async () => { throw new Error('overloaded'); }) } as unknown as Gateway;
    const embedder = embedderFor({ a: 1, b: 1 });

    await expect(runGroupJob({ prisma, gateway, embedder }, { questionId: q.id })).rejects.toThrow('overloaded');
    expect((await prisma.question.findUniqueOrThrow({ where: { id: q.id } })).groupedAt).toBeNull();
    expect(await prisma.modelCall.count({ where: { pageId, ok: false } })).toBe(1);
  });

  it('caches wording vectors so a second job embeds nothing new', async () => {
    const pageId = await aPage();
    await aWording(pageId, 'a', { grouped: true });
    const q = await aWording(pageId, 'b');
    const base = embedderFor({ a: 1, b: 2 });
    const embed = vi.fn((texts: string[]) => base.embed(texts));
    const embedder = { ...embedderFor({}), embed };
    const { gateway } = gatewaySaying(() => null);
    await runGroupJob({ prisma, gateway, embedder }, { questionId: q.id });
    const q2 = await aWording(pageId, 'b again');
    await runGroupJob({ prisma, gateway, embedder }, { questionId: q2.id });
    const embeddedTexts = embed.mock.calls.flatMap(([texts]) => texts);
    expect(embeddedTexts.filter((t) => t === 'a')).toHaveLength(1);
  });

  it('treats an id that was not offered as none, and moves nothing', async () => {
    const pageId = await aPage();
    const otherPage = await aPage();
    const foreign = await aWording(otherPage, 'twin', { grouped: true });
    await aWording(pageId, 'near', { grouped: true });
    const q = await aWording(pageId, 'me');
    const { gateway, calls } = gatewaySaying(() => foreign.topicId);
    const embedder = embedderFor({ twin: 1, near: 1, me: 1 });

    await expect(runGroupJob({ prisma, gateway, embedder }, { questionId: q.id })).resolves.toBe('none');
    expect(calls).toHaveLength(1);
    const after = await prisma.question.findUniqueOrThrow({ where: { id: q.id } });
    expect(after.topicId).toBe(q.topicId);
    expect(after.groupedAt).not.toBeNull();
  });
});
