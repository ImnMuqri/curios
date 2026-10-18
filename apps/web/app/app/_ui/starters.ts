/** What to try asking a page before any customer has asked it anything. */
export const STARTERS = {
  BUSINESS: ['How much is it?', 'When are you open?', 'Where are you?', 'Can I cancel?'],
  PERSONAL: ['What do you do?', 'How can I reach you?', 'Where are you based?', 'What have you worked on?'],
} as const;
