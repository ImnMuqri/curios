/**
 * The help guide (faq.md) as data: the only thing the dashboard's Help chat answers from.
 *
 * Imports nothing that reaches node: the API reads it to build the prompt and to hand the panel its
 * topics, and the web app reads the screen map. The markdown itself arrives as a string
 * (guide.generated.ts, rebuilt by `pnpm --filter @curios/core gen:help` and checked fresh by a test),
 * because the three apps bundle differently and none of them can read a .md file the same way.
 */
import { ringgit } from '../money.js';

export interface HelpEntry {
  /** "shop-vouchers": stable, the model answers with it and the log keeps it. */
  id: string;
  question: string;
  /** May hold placeholders ({monthlyPrice}) until fillGuide. */
  answer: string;
  /** A dashboard path ("/app/store", "/app/knowledge?tab=pinned"), or null for none. */
  open: string | null;
  /** Where the answer was checked. For whoever edits the guide; never sent to an owner. */
  source: string;
  section: string;
}

export interface HelpSection {
  title: string;
  entries: HelpEntry[];
}

export interface HelpGuide {
  sections: HelpSection[];
  entries: HelpEntry[];
}

/** What an owner's browser gets: no Source lines, numbers already filled. */
export interface PublicHelpEntry {
  id: string;
  question: string;
  answer: string;
  open: string | null;
}

export interface PublicHelpSection {
  title: string;
  entries: PublicHelpEntry[];
}

const HEADING = /^###\s+([a-z0-9-]+)\s+·\s+(.+?)\s*$/;

/**
 * Strict on purpose: a malformed entry is a broken guide, and the test that parses the real file
 * at build time is how an editor finds out. Throws with the line number.
 */
export function parseGuide(markdown: string): HelpGuide {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const sections: HelpSection[] = [];
  let section: HelpSection | null = null;
  let entry: { id: string; question: string; body: string[]; open?: string; source?: string; line: number } | null = null;

  const close = () => {
    if (!entry) return;
    if (!section) throw new Error(`help guide line ${entry.line}: entry ${entry.id} is outside a section`);
    if (entry.open === undefined) throw new Error(`help guide line ${entry.line}: entry ${entry.id} has no Open: line`);
    if (entry.source === undefined) throw new Error(`help guide line ${entry.line}: entry ${entry.id} has no Source: line`);
    const answer = entry.body.join(' ').replace(/\s+/g, ' ').trim();
    if (!answer) throw new Error(`help guide line ${entry.line}: entry ${entry.id} has no answer`);
    section.entries.push({
      id: entry.id,
      question: entry.question,
      answer,
      open: entry.open === 'none' ? null : entry.open,
      source: entry.source,
      section: section.title,
    });
    entry = null;
  };

  lines.forEach((raw, i) => {
    const line = raw.trimEnd();
    if (line.startsWith('## ')) {
      close();
      section = { title: line.slice(3).trim(), entries: [] };
      sections.push(section);
      return;
    }
    if (line.startsWith('### ')) {
      close();
      const match = HEADING.exec(line);
      if (!match) throw new Error(`help guide line ${i + 1}: expected "### id · question", got ${JSON.stringify(line)}`);
      entry = { id: match[1]!, question: match[2]!, body: [], line: i + 1 };
      return;
    }
    if (!entry) return;
    if (line.startsWith('Open:')) entry.open = line.slice(5).trim();
    else if (line.startsWith('Source:')) entry.source = line.slice(7).trim();
    else if (line === '---') close();
    else if (line.trim() && entry.open === undefined) entry.body.push(line.trim());
  });
  close();

  const kept = sections.filter((s) => s.entries.length > 0);
  const entries = kept.flatMap((s) => s.entries);
  const seen = new Set<string>();
  for (const e of entries) {
    if (seen.has(e.id)) throw new Error(`help guide: id ${e.id} is used twice`);
    seen.add(e.id);
  }
  return { sections: kept, entries };
}

/** The numbers the admin can change, as the guide writes them. */
export interface GuideTerms {
  prices: { MONTHLY: number; ANNUAL: number };
  freeLeads: number;
  freeOrders: number;
  cap: number;
}

/**
 * "two months free" only while the year costs ten months; otherwise what a year saves, or nothing.
 * The guide writes "{annualPrice} a year ({annualSaving})", so the brackets go with an empty saving.
 */
function annualSaving(prices: GuideTerms['prices']): string {
  const year = prices.MONTHLY * 12;
  if (prices.ANNUAL >= year) return '';
  if (prices.ANNUAL === prices.MONTHLY * 10) return 'two months free';
  return `${ringgit(year - prices.ANNUAL)} less than paying monthly`;
}

export const GUIDE_PLACEHOLDERS = ['monthlyPrice', 'annualPrice', 'annualSaving', 'freeLeads', 'freeOrders', 'conversationCap'] as const;

/** Every placeholder filled from the live settings, so the chat never quotes an old price. */
export function fillPlaceholders(text: string, terms: GuideTerms): string {
  const values: Record<(typeof GUIDE_PLACEHOLDERS)[number], string> = {
    monthlyPrice: ringgit(terms.prices.MONTHLY),
    annualPrice: ringgit(terms.prices.ANNUAL),
    annualSaving: annualSaving(terms.prices),
    freeLeads: String(terms.freeLeads),
    freeOrders: String(terms.freeOrders),
    conversationCap: terms.cap.toLocaleString('en-MY'),
  };
  return text
    .replace(/\{(\w+)\}/g, (whole, key: string) => (key in values ? values[key as keyof typeof values] : whole))
    .replace(/\s*\(\)/g, '');
}

/** The guide as an owner may see it: numbers filled, Source lines gone. */
export function publicGuide(guide: HelpGuide, terms: GuideTerms): PublicHelpSection[] {
  return guide.sections.map((s) => ({
    title: s.title,
    entries: s.entries.map((e) => ({ id: e.id, question: e.question, answer: fillPlaceholders(e.answer, terms), open: e.open })),
  }));
}

/** The dashboard screens Help knows, by the first path segment after /app. */
export const HELP_SCREENS = ['home', 'curios', 'store', 'orders', 'questions', 'leads', 'review', 'knowledge', 'billing', 'settings'] as const;
export type HelpScreen = (typeof HELP_SCREENS)[number];

export const HELP_SCREEN_NAMES: Record<HelpScreen, string> = {
  home: 'the dashboard',
  curios: 'My Curios',
  store: 'Store',
  orders: 'Orders',
  questions: 'Questions',
  leads: 'Leads',
  review: 'Review',
  knowledge: 'Facts & sources',
  billing: 'Billing',
  settings: 'Settings',
};

/** "/app/store/items" -> "store"; anything Help does not know -> "home". */
export function helpScreenFor(pathname: string): HelpScreen {
  const segment = /^\/app\/([^/?#]+)/.exec(pathname)?.[1];
  return (HELP_SCREENS as readonly string[]).includes(segment ?? '') ? (segment as HelpScreen) : 'home';
}

/** Four entries per screen for the start state ("People on Settings often ask"). A test checks every id exists. */
export const HELP_SUGGESTIONS: Record<HelpScreen, readonly [string, string, string, string]> = {
  home: ['start-publish', 'know-how', 'lead-what', 'start-personal-business'],
  curios: ['page-look', 'page-links', 'page-shop-tile', 'start-address'],
  store: ['shop-open', 'shop-pay', 'shop-vouchers', 'shop-pickup'],
  orders: ['order-flow', 'order-refund', 'digital-links', 'order-free'],
  questions: ['q-what', 'q-faq-pages', 'q-merge', 'q-pinned'],
  leads: ['lead-what', 'lead-none', 'lead-reply', 'lead-delete'],
  review: ['know-review', 'know-own-fact', 'know-invent', 'know-wrong'],
  knowledge: ['know-files', 'know-wrong', 'know-never-say', 'know-test'],
  billing: ['bill-price', 'bill-renew', 'bill-trial', 'bill-lapse'],
  settings: ['acc-emails', 'page-google', 'acc-signin', 'acc-delete'],
};

/**
 * The topics search: every word typed must appear in the question or the answer. No model, so it
 * works while the chat is resting.
 */
export function searchGuide(sections: PublicHelpSection[], query: string): PublicHelpEntry[] {
  const words = query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1);
  if (words.length === 0) return [];
  return sections
    .flatMap((s) => s.entries)
    .filter((e) => {
      const text = `${e.question} ${e.answer}`.toLowerCase();
      return words.every((w) => text.includes(w));
    });
}
