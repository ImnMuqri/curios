import type { SwitchKey } from '@curios/core/settings';

/** The five switches, in the board's order, with its titles and sublines (two amended: DEVIATIONS 227). */
export const SWITCHES: { key: SwitchKey; title: string; subline: string }[] = [
  { key: 'chat', title: 'Chat answers', subline: 'Off: every page gives the short fixed reply and points to its links.' },
  { key: 'signups', title: 'New sign-ups', subline: 'Off: the sign-up page says Curios is full for now.' },
  { key: 'reading', title: 'Reading new sources', subline: 'Off: new websites, pastes and files wait in the queue.' },
  { key: 'chipPayments', title: 'Online payments (CHIP)', subline: 'Off: checkouts offer only the owner’s own QR or bank transfer.' },
  { key: 'ownerEmails', title: 'Emails to owners', subline: 'Off: emails to owners are not sent. Sign-in and password emails still go.' },
];

/** "Chat answers" in a sentence: "chat answers". Only the first letter, so "(CHIP)" stays as written. */
export const lowerFirst = (title: string) => title.charAt(0).toLowerCase() + title.slice(1);

/** The title as the audit log says it, mid-sentence: "chat answers". */
export const switchTitle = (key: string): string | undefined => {
  const found = SWITCHES.find((s) => s.key === key);
  return found && lowerFirst(found.title);
};
