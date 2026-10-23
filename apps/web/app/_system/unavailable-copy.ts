const COPY = {
  en: { title: 'This page is unavailable', lede: 'It’s been taken down for now.', home: 'Go to Curios' },
  ms: { title: 'Halaman ini tidak tersedia', lede: 'Ia diturunkan buat masa ini.', home: 'Pergi ke Curios' },
} as const;

/** The suspended-page words, in the page's language. Plain data, so client and server screens share it. */
export const unavailableCopy = (language: string) => (language === 'ms' ? COPY.ms : COPY.en);
