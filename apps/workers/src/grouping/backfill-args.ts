/**
 * The page to limit the backfill to, from process.argv.slice(2). pnpm forwards
 * a literal `--` (`group:backfill -- <pageId>`), which is not a page id.
 */
export function pageIdFromArgs(args: string[]): string | undefined {
  return args.find((arg) => arg !== '--');
}
