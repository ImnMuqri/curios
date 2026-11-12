/* global process, console */
// Rebuilds src/help/guide.generated.ts from src/help/faq.md. Run after editing the guide:
//   pnpm --filter @curios/core gen:help
// guide.test.ts fails while the two disagree.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'help');
export function generated(markdown) {
  return `// Generated from faq.md by scripts/gen-help-guide.mjs. Do not edit: edit faq.md and run\n// \`pnpm --filter @curios/core gen:help\`.\nexport const HELP_GUIDE_MARKDOWN = ${JSON.stringify(markdown.replace(/\r\n/g, '\n'))};\n`;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeFileSync(join(dir, 'guide.generated.ts'), generated(readFileSync(join(dir, 'faq.md'), 'utf8')));
  console.log('help guide generated');
}
