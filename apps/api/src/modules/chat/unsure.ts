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

/** The longest end of `text` that could be the start of the marker, held back until the next piece says. */
function markerPrefixAtEnd(text: string): number {
  for (let n = Math.min(UNSURE_MARKER.length - 1, text.length); n > 0; n -= 1) {
    if (UNSURE_MARKER.startsWith(text.slice(-n))) return n;
  }
  return 0;
}

/** The text with every marker in it removed, and the space that followed one. */
const withoutMarker = (text: string): string => text.split(`${UNSURE_MARKER} `).join('').split(UNSURE_MARKER).join('');

/**
 * Filters a reply's stream: `push` each piece and send on what it returns;
 * `end` when the stream closes and send that too. `unsure` says, once the
 * start has been seen, whether the reply carried the marker.
 *
 * Only a marker at the start makes a reply "not sure". One the model puts
 * anywhere else -- after answering part of a question -- is removed all the
 * same, so a visitor never reads it, even split across two pieces.
 */
export function unsureFilter() {
  let start = '';
  let decided = false;
  let unsure = false;
  // After the start: the end of the last piece that could be the beginning of a marker.
  let held = '';

  const pass = (text: string): string => {
    const joined = withoutMarker(held + text);
    const keep = markerPrefixAtEnd(joined);
    held = joined.slice(joined.length - keep);
    return joined.slice(0, joined.length - keep);
  };

  const decide = (): string => {
    decided = true;
    const trimmed = start.trimStart();
    if (trimmed.startsWith(UNSURE_MARKER)) {
      unsure = true;
      return pass(trimmed.slice(UNSURE_MARKER.length).trimStart());
    }
    return pass(start);
  };

  return {
    push(text: string): string {
      if (decided) return pass(text);
      start += text;
      const trimmed = start.trimStart();
      // Still could be the marker: hold it back a little longer.
      if (trimmed.length < UNSURE_MARKER.length && UNSURE_MARKER.startsWith(trimmed)) return '';
      return decide();
    },
    end(): string {
      // Whatever was held back was not a marker after all: it is the reply's own text.
      const rest = decided ? held : decide() + held;
      held = '';
      return rest;
    },
    get unsure(): boolean {
      return unsure;
    },
  };
}
