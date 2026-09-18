/**
 * Whether search engines may index a page.
 *
 * Every business page, and a personal page only when its owner has opted in.
 * The personal default is private because most people do not want an AI page
 * about themselves ranking for their own name -- README's Personal privacy
 * decision -- and a default has to be the safe one.
 *
 * One function, called by the public page's metadata, so the rule is written
 * once. Two expressions of one rule are how a page and a test end up
 * disagreeing about it, which is `canCapture`'s reason for existing too.
 */
export function shouldIndex(input: {
  mode: 'PERSONAL' | 'BUSINESS';
  allowSearchIndexing: boolean;
}): boolean {
  return input.mode === 'BUSINESS' || input.allowSearchIndexing;
}
