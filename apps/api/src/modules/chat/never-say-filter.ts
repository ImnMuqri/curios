/**
 * The page's never-say list, enforced on what the model writes rather than asked of it.
 *
 * The prompt tells the model never to use these words, and it usually obeys; "usually" is not good
 * enough for a word like "halal", where a wrong claim is an offence in Malaysia. So the reply is
 * passed on a sentence at a time, and a sentence that contains a never-say phrase is dropped whole:
 * the visitor never reads the phrase, nor a sentence with a hole where it was.
 *
 * Matched the way the golden set checks it (packages/goldens/src/rules.ts): case-insensitive and
 * anywhere in the text, so "jamin" also stops "dijamin" and "jaminan". Runs of whitespace count as
 * one space, so a phrase broken across a line still matches.
 *
 * Only the model's reply goes through this. The owner's own pinned answers are their words, sent
 * as they wrote them.
 */

/** Sent when every sentence of a reply was dropped: the question is one for the owner. */
export const NEVER_SAY_FALLBACK =
  'Yang itu saya perlu semak dengan pemilik dulu.\n\nThat one I need to check with the owner first.';

const normalise = (text: string) => text.toLowerCase().replace(/\s+/g, ' ');

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

/**
 * Filters a reply's stream: `push` each piece and send on what it returns; `end` when the stream
 * closes and send that too. Text is held back only until its sentence ends.
 */
export function neverSayFilter(phrases: readonly string[]) {
  const banned = phrases.map(normalise).map((p) => p.trim()).filter(Boolean);
  let pending = '';
  let sent = 0;
  let dropped = 0;

  const judge = (sentence: string): string => {
    const text = normalise(sentence);
    if (banned.some((phrase) => text.includes(phrase))) {
      dropped += 1;
      return '';
    }
    if (sentence.trim()) sent += 1;
    return sentence;
  };

  return {
    push(text: string): string {
      if (banned.length === 0) return text;
      pending += text;
      let out = '';
      for (let end = sentenceEnd(pending); end >= 0; end = sentenceEnd(pending)) {
        out += judge(pending.slice(0, end));
        pending = pending.slice(end);
      }
      return out;
    },
    end(): string {
      if (banned.length === 0) return '';
      const last = judge(pending);
      pending = '';
      // Nothing left to say: say who can answer it rather than send an empty bubble.
      return sent === 0 && dropped > 0 ? NEVER_SAY_FALLBACK : last;
    },
    /** How many sentences were dropped, for the log. */
    get dropped(): number {
      return dropped;
    },
    /** True when the whole reply was dropped and the fallback went in its place. */
    get replaced(): boolean {
      return sent === 0 && dropped > 0;
    },
  };
}
