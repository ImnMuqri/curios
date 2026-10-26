/**
 * Two promises the chat makes, enforced on what the model writes rather than asked of it. The
 * prompt asks for both and the model usually obeys; "usually" is not good enough for either.
 *
 * - Never-say: the page's never-say words never appear. For a word like "halal" a wrong claim is
 *   an offence in Malaysia. Matched the way the golden set checks it (packages/goldens/src/rules.ts):
 *   case-insensitive and anywhere in the text, so "jamin" also stops "dijamin" and "jaminan".
 * - No invented amount: every ringgit amount the reply states is one the model was given as money
 *   -- "RM95" or "95 ringgit" in a fact, an owner answer, the shop, the page's profile, an earlier
 *   reply -- or any number the visitor typed. A bare number the page holds is not enough: "1kg" and
 *   "3 hari" would otherwise license RM1 and RM3. Prices reach the page with RM on them (every price
 *   fact on the development page does, and the shop writes its own), so this costs little.
 *   The golden set caught "Untuk 2kg, harga akan jadi RM190" from a page whose only price was RM95
 *   for 1kg, and a customer holds the owner to a price the chat states.
 *
 * The reply is passed on a sentence at a time, and a sentence that breaks either promise is dropped
 * whole: the visitor never reads it, nor a sentence with a hole where it was. When nothing is left,
 * the visitor is told the owner will be asked. Strict on purpose: an amount the owner wrote in words
 * ("eighty ringgit") and the model wrote in figures is dropped too. A lost sentence is a question for
 * the owner; a wrong price is a promise they did not make.
 *
 * Only the model's reply goes through this. The owner's own pinned answers are their words, sent as
 * they wrote them.
 */

/** Sent when every sentence of a reply was dropped: the question is one for the owner. */
export const REPLY_FALLBACK =
  'Yang itu saya perlu semak dengan pemilik dulu.\n\nThat one I need to check with the owner first.';

const normalise = (text: string) => text.toLowerCase().replace(/\s+/g, ' ');

/** A number as written ("1,500", "9.50", "95"), in hundredths, so RM95 and RM95.00 are one amount. */
const hundredths = (written: string): number => Math.round(Number.parseFloat(written.replace(/,/g, '')) * 100);

const NUMBER = /\d[\d,]*(?:\.\d+)?/g;
const MONEY = /\bRM\s*(\d[\d,]*(?:\.\d+)?)|(\d[\d,]*(?:\.\d+)?)\s*ringgit\b/gi;

/** Every number written anywhere in `text`, as hundredths: what a visitor's words allow. */
export function numbersIn(text: string): Set<number> {
  return new Set([...text.matchAll(NUMBER)].map((m) => hundredths(m[0].replace(/,+$/, ''))));
}

/** Every amount of money `text` states ("RM95", "RM 1,500.00", "95 ringgit"), as hundredths. */
export function amountsIn(text: string): number[] {
  return [...text.matchAll(MONEY)].map((m) => hundredths((m[1] ?? m[2] ?? '').replace(/,+$/, '')));
}

/**
 * Where the first sentence in `text` ends: after its closing punctuation and the space after it,
 * or after a blank line. A full stop followed by a digit ("RM9.50") or a letter ("e.g") is not
 * the end of a sentence; only one followed by whitespace is. A single line break is not an end
 * either, so a phrase the model wraps onto the next line is still judged whole.
 */
function sentenceEnd(text: string): number {
  const match = /[.!?]+\s+|\n\s*\n/.exec(text);
  return match ? match.index + match[0].length : -1;
}

export type DropReason = 'never-say' | 'amount';

/**
 * Filters a reply's stream: `push` each piece and send on what it returns; `end` when the stream
 * closes and send that too. Text is held back only until its sentence ends.
 *
 * `given` is what the model was given -- the system prompt and its own earlier replies -- whose
 * amounts of money it may state. `visitor` is what the visitor typed, any number of which it may
 * say back to them ("bajet saya 150").
 */
export function replyGuard(input: { neverSay: readonly string[]; given: string; visitor: string }) {
  const banned = input.neverSay.map(normalise).map((p) => p.trim()).filter(Boolean);
  const allowed = new Set([...amountsIn(input.given), ...numbersIn(input.visitor)]);
  let pending = '';
  let sent = 0;
  const dropped: Record<DropReason, number> = { 'never-say': 0, amount: 0 };

  const reasonFor = (sentence: string): DropReason | null => {
    const text = normalise(sentence);
    if (banned.some((phrase) => text.includes(phrase))) return 'never-say';
    if (amountsIn(sentence).some((amount) => !allowed.has(amount))) return 'amount';
    return null;
  };

  const judge = (sentence: string): string => {
    const reason = reasonFor(sentence);
    if (reason) {
      dropped[reason] += 1;
      return '';
    }
    if (sentence.trim()) sent += 1;
    return sentence;
  };

  const droppedAny = () => dropped['never-say'] + dropped.amount > 0;

  return {
    push(text: string): string {
      pending += text;
      let out = '';
      for (let end = sentenceEnd(pending); end >= 0; end = sentenceEnd(pending)) {
        out += judge(pending.slice(0, end));
        pending = pending.slice(end);
      }
      return out;
    },
    end(): string {
      const last = judge(pending);
      pending = '';
      // Nothing left to say: say who can answer it rather than send an empty bubble.
      return sent === 0 && droppedAny() ? REPLY_FALLBACK : last;
    },
    /** Sentences dropped so far, by which promise they broke, for the log. */
    get dropped(): Readonly<Record<DropReason, number>> {
      return dropped;
    },
    /** True when the whole reply was dropped and the fallback went in its place. */
    get replaced(): boolean {
      return sent === 0 && droppedAny();
    },
  };
}
