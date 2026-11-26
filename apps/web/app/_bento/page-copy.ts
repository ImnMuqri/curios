/**
 * The public page's own words, around the owner's: its tabs, the FAQ
 * accordion and the footer. Two languages, like the shop's copy: a page whose
 * language is anything else reads English.
 */
export interface PageCopy {
  links: string;
  ask: string;
  shop: string;
  sections: string;
  oftenAsk: string;
  seeAll: (n: number) => string;
  questions: string;
  madeWith: string;
  report: string;
  /** A music card's type line, by the English name cardTypeName gives; plain strings, so the object can cross to a client component. */
  cardTypes: Record<string, string>;
  /** A music card's spoken name; `{type}` and `{service}` are filled in. */
  cardOn: string;
}

const EN: PageCopy = {
  links: 'Links',
  ask: 'Ask',
  shop: 'Shop',
  sections: 'Page sections',
  oftenAsk: 'People often ask',
  seeAll: (n) => `See all ${n}`,
  questions: 'Questions',
  madeWith: 'Made with Curios',
  report: 'Report this page',
  cardTypes: { Song: 'Song', Album: 'Album', Playlist: 'Playlist', Artist: 'Artist', Podcast: 'Podcast', Episode: 'Episode' },
  cardOn: '{type} on {service}',
};

const MS: PageCopy = {
  links: 'Pautan',
  ask: 'Tanya',
  shop: 'Kedai',
  sections: 'Bahagian halaman',
  oftenAsk: 'Orang selalu tanya',
  seeAll: (n) => `Lihat semua ${n}`,
  questions: 'Soalan',
  madeWith: 'Dibuat dengan Curios',
  report: 'Laporkan halaman ini',
  cardTypes: { Song: 'Lagu', Album: 'Album', Playlist: 'Senarai main', Artist: 'Artis', Podcast: 'Podcast', Episode: 'Episod' },
  cardOn: '{type} di {service}',
};

export function pageCopy(language: string | undefined): PageCopy {
  return language === 'ms' ? MS : EN;
}
