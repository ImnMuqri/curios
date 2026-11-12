/**
 * The parsed help guide, for the API and admin (server code). It carries every entry's Source line,
 * so the web app imports `@curios/core/help` (guide.ts) instead and gets its topics from the API.
 */
import { HELP_GUIDE_MARKDOWN } from './guide.generated.js';
import { parseGuide, type HelpGuide } from './guide.js';

export * from './guide.js';

let parsed: HelpGuide | null = null;
export function helpGuide(): HelpGuide {
  parsed ??= parseGuide(HELP_GUIDE_MARKDOWN);
  return parsed;
}
