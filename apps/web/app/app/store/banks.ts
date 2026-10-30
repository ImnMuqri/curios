/**
 * The banks in Malaysia an owner may be paid into, for the bank picker (bank-picker.tsx). The name is
 * what is saved and what a customer reads at checkout, so it is the one people say ("Maybank", not
 * "Malayan Banking Berhad"). Each logo is `/banks/<id>.<ext>` in the web app's public folder.
 *
 * `aliases` are other ways owners typed the same bank before the picker, so an older shop's
 * "Hong Leong" still shows Hong Leong Bank's logo.
 */
export interface Bank {
  id: string;
  name: string;
  logo: string;
  aliases?: string[];
}

const bank = (id: string, name: string, aliases: string[] = [], ext: 'svg' | 'png' = 'svg'): Bank => ({
  id,
  name,
  logo: `/banks/${id}.${ext}`,
  ...(aliases.length > 0 ? { aliases } : {}),
});

export const BANKS: readonly Bank[] = [
  bank('maybank', 'Maybank', ['Malayan Banking', 'MBB']),
  bank('cimb', 'CIMB Bank', ['CIMB'], 'png'),
  bank('publicbank', 'Public Bank', ['PBB', 'Public Bank Berhad']),
  bank('rhb', 'RHB Bank', ['RHB']),
  bank('hlb', 'Hong Leong Bank', ['Hong Leong', 'HLB']),
  bank('ambank', 'AmBank', ['Am Bank']),
  bank('bankislam', 'Bank Islam', ['Bank Islam Malaysia', 'BIMB'], 'png'),
  bank('rakyat', 'Bank Rakyat', [], 'png'),
  bank('bsn', 'BSN', ['Bank Simpanan Nasional'], 'png'),
  bank('muamalat', 'Bank Muamalat', ['Muamalat'], 'png'),
  bank('affin', 'Affin Bank', ['Affin', 'AffinBank'], 'png'),
  bank('alliance', 'Alliance Bank', ['Alliance'], 'png'),
  bank('uob', 'UOB', ['United Overseas Bank']),
  bank('ocbc', 'OCBC', ['OCBC Bank']),
  bank('hsbc', 'HSBC', ['HSBC Bank']),
  bank('sc', 'Standard Chartered', ['StanChart', 'SCB']),
  bank('agrobank', 'Agrobank', ['Agro Bank', 'Bank Pertanian']),
  bank('alrajhi', 'Al Rajhi Bank', ['Al-Rajhi', 'Al Rajhi']),
  bank('kfh', 'Kuwait Finance House', ['KFH'], 'png'),
  bank('mbsb', 'MBSB Bank', ['MBSB'], 'png'),
  bank('bankofchina', 'Bank of China', ['BOC']),
  bank('gxbank', 'GXBank', ['GX Bank'], 'png'),
  bank('boost', 'Boost Bank'),
  bank('aeon', 'AEON Bank', ['AEON'], 'png'),
  bank('ryt', 'Ryt Bank', ['Ryt'], 'png'),
];

const key = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, '');

/** The listed bank a saved or typed name means, by its name or an alias; null for one not listed. */
export function bankFor(name: string | null | undefined): Bank | null {
  if (!name) return null;
  const k = key(name);
  return BANKS.find((b) => key(b.name) === k || b.aliases?.some((alias) => key(alias) === k)) ?? null;
}

/** The banks matching what is typed: by the start of any word in the name or an alias, so "isl" finds Bank Islam. */
export function banksMatching(query: string): readonly Bank[] {
  const q = query.trim().toLowerCase();
  if (!q || bankFor(query)) return BANKS;
  const starts = (text: string) => text.toLowerCase().split(/[\s-]+/).some((word) => word.startsWith(q)) || text.toLowerCase().startsWith(q);
  return BANKS.filter((b) => starts(b.name) || b.aliases?.some(starts));
}
