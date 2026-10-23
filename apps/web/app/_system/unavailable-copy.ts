const COPY = {
  en: { title: 'This page is unavailable', lede: 'It’s been taken down for now.' },
  ms: { title: 'Halaman ini tidak tersedia', lede: 'Ia diturunkan buat masa ini.' },
} as const;

/** The suspended-page words, in the page's language. Plain data, so client and server screens share it. */
export const unavailableCopy = (language: string) => (language === 'ms' ? COPY.ms : COPY.en);
