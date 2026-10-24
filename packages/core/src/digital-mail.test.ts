import { describe, expect, it } from 'vitest';
import { digitalDeliveryMail, paidAndSentOwnerMail, sessionTimeText } from './digital-mail.js';

const items = [
  { name: 'Recipe e-book', optionLabel: null, quantity: 1, delivery: 'FILES' as const, downloads: [{ name: 'recipe.pdf', url: 'https://api.example/store/orders/t/files/g1' }], link: null, codes: [], session: null },
  { name: 'Video course', optionLabel: null, quantity: 1, delivery: 'LINK' as const, downloads: [], link: { url: 'https://api.example/store/orders/t/link/l1', note: 'Start here' }, codes: [], session: null },
  { name: 'Voucher', optionLabel: null, quantity: 2, delivery: 'CODES' as const, downloads: [], link: null, codes: ['C-1', 'C-2'], session: null },
  { name: 'Class', optionLabel: null, quantity: 1, delivery: 'SESSION' as const, downloads: [], link: null, codes: [], session: { startsAt: new Date('2026-10-31T07:00:00Z'), minutes: 90, place: 'ONLINE' as const, where: 'https://meet.example/abc' } },
];
const base = { number: 7, shopName: 'Kek Lina', customerName: 'Mira', items, orderUrl: 'https://curios.my/kek/order/t' };

describe('digitalDeliveryMail', () => {
  it('lists links, note, codes, time and join, and opens the order page', () => {
    const mail = digitalDeliveryMail({ ...base, lang: 'en' });
    expect(mail.subject).toBe('Your order #7 from Kek Lina');
    for (const part of ['files/g1', 'link/l1', 'Start here', 'C-1', 'C-2', 'Sat 31 Oct, 3:00 pm', '90 minutes', 'https://meet.example/abc', 'Open your order page: https://curios.my/kek/order/t']) {
      expect(mail.text).toContain(part);
    }
    expect(mail.html).toContain('files/g1');
  });

  it('is in Malay for a Malay page', () => {
    const mail = digitalDeliveryMail({ ...base, lang: 'ms' });
    expect(mail.subject).toBe('Tempahan #7 anda dari Kek Lina');
    expect(mail.text).toContain('Muat turun recipe.pdf');
    expect(mail.text).toContain('Sab 31 Okt, 3:00 petang');
  });

  it('carries no links, and says to use the order page, when the order link is unknown', () => {
    const open = items.map((i) => ({ ...i, downloads: i.downloads.map((d) => ({ ...d, url: null })), link: i.link ? { ...i.link, url: null } : null }));
    const mail = digitalDeliveryMail({ ...base, lang: 'en', items: open, orderUrl: null });
    expect(mail.text).not.toMatch(/https:\/\/api\.example|curios\.my/);
    expect(mail.text).toContain('Open your order page to get your downloads and links.');
    expect(mail.text).toContain('C-1');
  });
});

describe('sessionTimeText', () => {
  it('reads the Malaysian clock', () => {
    expect(sessionTimeText(new Date('2026-10-31T16:30:00Z'), 'en')).toBe('Sun 1 Nov, 12:30 am');
  });
});

describe('paidAndSentOwnerMail', () => {
  it('says paid and sent, with nothing to do', () => {
    const mail = paidAndSentOwnerMail({
      number: 7,
      totalCents: 10_400,
      customerName: 'Mira',
      via: 'FPX · Maybank2u',
      ref: 'CH1',
      lines: [{ itemName: 'Recipe e-book', optionLabel: null, quantity: 1, lineCents: 10_400 }],
      url: 'https://curios.my/app/orders?order=o1',
    });
    expect(mail.subject).toBe('New order #7 · RM104 · Paid and sent');
    expect(mail.text).toContain('nothing for you to do');
    expect(mail.text).toContain('FPX · Maybank2u · Ref CH1');
  });
});
