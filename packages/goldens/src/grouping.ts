import { cosineSimilarity, GROUP_SHORTLIST_MIN } from '@curios/core';
import { createOpenAiEmbedder } from '@curios/embeddings';
import { createAnthropicGateway } from '@curios/gateway';

/**
 * Pairs the grouping verdict must get right, through the same two gates as
 * production: the embedding shortlist (cosine >= GROUP_SHORTLIST_MIN, else the
 * model is never asked), then the model. The printed cosines are what to tune
 * GROUP_SHORTLIST_MIN against. Spends real calls. Run: pnpm --filter @curios/goldens start:grouping */
const CASES: { page: string; mode: 'PERSONAL' | 'BUSINESS'; wording: string; topic: string; same: boolean; why: string }[] = [
  { page: 'Iman Muqri', mode: 'PERSONAL', wording: 'What is his full name', topic: "What is Iman's full name", same: true, why: 'a pronoun for the owner' },
  { page: 'Bsyx Labs', mode: 'BUSINESS', wording: 'FPX boleh?', topic: 'Do you take FPX?', same: true, why: 'Malay and English, one answer' },
  { page: 'Nadia Bakes', mode: 'BUSINESS', wording: 'Kek 2kg berapa?', topic: 'Kek 1kg berapa?', same: false, why: 'different sizes, different prices' },
  { page: 'Nadia Bakes', mode: 'BUSINESS', wording: 'Can you deliver to Shah Alam?', topic: 'Can I pick up from your shop?', same: false, why: 'delivery is not pickup' },
];

async function main() {
  const key = process.env.ANTHROPIC_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set');
  if (!openaiKey) throw new Error('OPENAI_API_KEY is not set');
  const gateway = createAnthropicGateway(key);
  const embedder = createOpenAiEmbedder(openaiKey);
  let failed = 0;
  for (const c of CASES) {
    const [a, b] = await embedder.embed([c.wording, c.topic]);
    if (!a || !b) throw new Error(`no embedding for: ${c.wording}`);
    const cosine = cosineSimilarity(a, b);
    const clears = cosine >= GROUP_SHORTLIST_MIN;
    const expected = `expected ${c.same ? 'same' : 'different'}: ${c.why}`;
    const pair = `${c.wording}  ~  ${c.topic}`;
    const score = `cosine ${cosine.toFixed(3)} ${clears ? 'clears' : 'below'} ${GROUP_SHORTLIST_MIN}`;

    if (!clears) {
      // Production never asks the model here: a "same" case is lost, a "different" one is right.
      const ok = !c.same;
      if (!ok) failed += 1;
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${pair}  [${score}; never reaches the model]  (${expected})`);
      continue;
    }

    const { match } = await gateway.sameQuestion({
      pageName: c.page, mode: c.mode, wording: c.wording,
      candidates: [{ id: 'topic', title: c.topic, wordings: [] }],
    });
    const ok = (match === 'topic') === c.same;
    if (!ok) failed += 1;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${pair}  [${score}; model said ${match === 'topic' ? 'same' : 'different'}]  (${expected})`);
  }
  console.log(`${CASES.length - failed}/${CASES.length} passed`);
  process.exitCode = failed === 0 ? 0 : 1;
}

void main();
