/**
 * How the chat says it could not answer, so the Questions screen can count
 * the asks it could ("Of asks the chat can answer").
 *
 * The prompt asks the model to begin a "not sure" reply with this marker. It
 * costs a few tokens on that reply and nothing on any other, needs no second
 * call, and is removed before a visitor sees anything: the stream holds back
 * the first few characters until it knows whether they are the marker.
 */
export const UNSURE_MARKER = '[?]';

/**
 * Filters a reply's stream: `push` each piece and send on what it returns;
 * `end` when the stream closes and send that too. `unsure` says, once the
 * start has been seen, whether the reply carried the marker.
 */
export function unsureFilter() {
  let start = '';
  let decided = false;
  let unsure = false;

  const decide = (): string => {
    decided = true;
    const trimmed = start.trimStart();
    if (trimmed.startsWith(UNSURE_MARKER)) {
      unsure = true;
      return trimmed.slice(UNSURE_MARKER.length).trimStart();
    }
    return start;
  };

  return {
    push(text: string): string {
      if (decided) return text;
      start += text;
      const trimmed = start.trimStart();
      // Still could be the marker: hold it back a little longer.
      if (trimmed.length < UNSURE_MARKER.length && UNSURE_MARKER.startsWith(trimmed)) return '';
      return decide();
    },
    end(): string {
      return decided ? '' : decide();
    },
    get unsure(): boolean {
      return unsure;
    },
  };
}
