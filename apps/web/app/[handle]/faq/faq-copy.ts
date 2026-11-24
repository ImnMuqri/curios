/**
 * The FAQ pages' own words (More board, cfaq and cfaqi), in the page's language: two languages, like the
 * shop's copy, and a page whose language is anything else reads English.
 */
export interface FaqCopy {
  kicker: (name: string) => string;
  indexTitle: (name: string) => string;
  indexLede: (name: string) => string;
  backTo: (name: string) => string;
  searchPlaceholder: string;
  nothingMatches: string;
  nothingBody: (name: string) => string;
  askName: (name: string) => string;
  askPlaceholder: (name: string) => string;
  askSend: string;
  answeredBy: (name: string, updated: string | null) => string;
  updated: (date: string) => string;
  moreQuestions: string;
  allQuestions: string;
  entryTitle: (question: string, name: string) => string;
}

const EN: FaqCopy = {
  kicker: (name) => `${name} · FAQ`,
  indexTitle: (name) => `Questions about ${name}`,
  indexLede: (name) => `What people ask ${name}, answered by ${name}.`,
  backTo: (name) => `Back to ${name}`,
  searchPlaceholder: 'Search questions',
  nothingMatches: 'Nothing matches',
  nothingBody: (name) => `Ask it on the page instead. ${name}’s page answers in a few seconds.`,
  askName: (name) => `Ask ${name}`,
  askPlaceholder: (name) => `Ask ${name} anything`,
  askSend: 'Ask',
  answeredBy: (name, updated) => (updated ? `Answered by ${name} · updated ${updated}` : `Answered by ${name}`),
  updated: (date) => `updated ${date}`,
  moreQuestions: 'More questions',
  allQuestions: 'All questions',
  entryTitle: (question, name) => `${question} · ${name}`,
};

const MS: FaqCopy = {
  kicker: (name) => `${name} · Soalan lazim`,
  indexTitle: (name) => `Soalan tentang ${name}`,
  indexLede: (name) => `Apa yang orang tanya ${name}, dijawab oleh ${name}.`,
  backTo: (name) => `Kembali ke ${name}`,
  searchPlaceholder: 'Cari soalan',
  nothingMatches: 'Tiada yang sepadan',
  nothingBody: (name) => `Tanya terus di halaman. Halaman ${name} menjawab dalam beberapa saat.`,
  askName: (name) => `Tanya ${name}`,
  askPlaceholder: (name) => `Tanya ${name} apa-apa sahaja`,
  askSend: 'Tanya',
  answeredBy: (name, updated) => (updated ? `Dijawab oleh ${name} · dikemas kini ${updated}` : `Dijawab oleh ${name}`),
  updated: (date) => `dikemas kini ${date}`,
  moreQuestions: 'Soalan lain',
  allQuestions: 'Semua soalan',
  entryTitle: (question, name) => `${question} · ${name}`,
};

export function faqCopy(language: string | undefined): FaqCopy {
  return language === 'ms' ? MS : EN;
}

/** The first of an answer for the list: up to `max` characters, cut at a word, never mid-word. */
export function excerpt(answer: string, max = 90): string {
  const text = answer.replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > 0 ? cut.slice(0, space) : cut).trimEnd()}…`;
}
