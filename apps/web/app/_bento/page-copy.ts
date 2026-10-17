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
};

export function pageCopy(language: string | undefined): PageCopy {
  return language === 'ms' ? MS : EN;
}
