import { createAnthropicGateway } from '@curios/gateway';

/** Pairs the grouping verdict must get right. Run: pnpm --filter @curios/goldens start:grouping */
const CASES: { page: string; mode: 'PERSONAL' | 'BUSINESS'; wording: string; topic: string; same: boolean; why: string }[] = [
  { page: 'Iman Muqri', mode: 'PERSONAL', wording: 'What is his full name', topic: "What is Iman's full name", same: true, why: 'a pronoun for the owner' },
  { page: 'Bsyx Labs', mode: 'BUSINESS', wording: 'FPX boleh?', topic: 'Do you take FPX?', same: true, why: 'Malay and English, one answer' },
  { page: 'Nadia Bakes', mode: 'BUSINESS', wording: 'Kek 2kg berapa?', topic: 'Kek 1kg berapa?', same: false, why: 'different sizes, different prices' },
  { page: 'Nadia Bakes', mode: 'BUSINESS', wording: 'Can you deliver to Shah Alam?', topic: 'Can I pick up from your shop?', same: false, why: 'delivery is not pickup' },
];

async function main() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set');
  const gateway = createAnthropicGateway(key);
  let failed = 0;
  for (const c of CASES) {
    const { match } = await gateway.sameQuestion({
      pageName: c.page, mode: c.mode, wording: c.wording,
      candidates: [{ id: 'topic', title: c.topic, wordings: [] }],
    });
    const same = match === 'topic';
    const ok = same === c.same;
    if (!ok) failed += 1;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.wording}  ~  ${c.topic}  (expected ${c.same ? 'same' : 'different'}: ${c.why})`);
  }
  console.log(`${CASES.length - failed}/${CASES.length} passed`);
  process.exitCode = failed === 0 ? 0 : 1;
}

void main();
