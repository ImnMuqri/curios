import { describe, expect, it } from 'vitest';
import { digitalDeliveryMail, paidAndSentOwnerMail, sessionReminderMail, sessionTimeText } from './digital-mail.js';

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
    for (const part of ['files/g1', 'link/l1', 'Start here', 'C-1', 'C-2', 'Sat 31 Oct, 3:00 pm', '90 minutes', 'https://meet.example/abc', 'Open your order page: https://curios.my/kek/order/t', 'Open the course']) {
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

describe('the board layout', () => {
  const sized = [
    { ...items[0]!, downloads: [{ name: 'recipe.pdf', url: 'https://api.example/store/orders/t/files/g1', sizeBytes: 4_404_019 }] },
    { ...items[3]!, session: { ...items[3]!.session!, lineId: 'l9' } },
  ];

  it('shows files with size, a Join and Add to calendar button, the shop as sender mark and its footer', () => {
    const mail = digitalDeliveryMail({ ...base, lang: 'en', items: sized, handle: 'kek', totalCents: 21_400, downloadsUntil: new Date('2026-11-14T00:00:00Z') });
    expect(mail.html).toContain('4.2 MB');
    expect(mail.html).toContain('Paid · RM214');
    expect(mail.html).toContain('Each link works 5 times, until 14 Nov.');
    expect(mail.html).toContain('Join the class');
    expect(mail.html).toContain('href="https://curios.my/kek/order/t/calendar?line=l9"');
    expect(mail.html).toContain('Add to calendar');
    expect(mail.html).toContain('curios.my/kek. Kek Lina sees your name, number and email for this order only.');
    expect(mail.html).not.toContain('wordmark');
  });

  it('escapes owner-entered text', () => {
    const evil = [
      { ...items[1]!, name: '<script>x</script>', link: { url: 'https://api.example/l', note: '<b>hi</b>' } },
      { ...items[0]!, downloads: [{ name: '"><img src=x>.pdf', url: 'https://api.example/f' }] },
    ];
    const mail = digitalDeliveryMail({ ...base, lang: 'en', shopName: 'A&B <Cakes>', customerName: '<i>Mira</i>', items: evil });
    expect(mail.html).not.toMatch(/<script>|<b>hi|<img src=x>|<i>Mira/);
    expect(mail.html).toContain('&lt;script&gt;');
    expect(mail.html).toContain('A&amp;B &lt;Cakes&gt;');
  });
});

describe('sessionReminderMail', () => {
  const session = { startsAt: new Date('2026-11-07T12:00:00Z'), minutes: 90, place: 'ONLINE' as const, where: 'https://meet.example/abc', lineId: 'l9' };
  const input = { lang: 'en' as const, number: 15, shopName: 'Kek Lina', handle: 'kek', itemName: 'Kek batik class', session, files: [{ name: 'list.pdf', url: 'https://api.example/files/1', sizeBytes: 225_280 }], orderUrl: 'https://curios.my/kek/order/t' };

  it('says tomorrow with the time, join, calendar and the files', () => {
    const mail = sessionReminderMail(input);
    expect(mail.subject).toBe('Your Kek batik class is tomorrow, 8:00 pm');
    for (const part of ['Tomorrow, 8:00 pm', 'Sat 7 Nov, 8:00 pm', '90 minutes · Online', 'https://meet.example/abc', '/order/t/calendar?line=l9', 'files/1']) {
      expect(mail.text + mail.html).toContain(part);
    }
    expect(mail.html).toContain('220 KB');
    expect(mail.html).toContain('Reply to Kek Lina');
  });

  it('is in Malay, and names the place for an in-person class', () => {
    const mail = sessionReminderMail({ ...input, lang: 'ms', files: [], session: { ...session, place: 'IN_PERSON', where: 'Studio <1>, Bangsar' } });
    expect(mail.subject).toBe('Kek batik class anda esok, 8:00 malam');
    expect(mail.text).toContain('Secara bersemuka, Studio <1>, Bangsar');
    expect(mail.html).toContain('Studio &lt;1&gt;, Bangsar');
    expect(mail.html).not.toContain('Join the class');
  });

  it('has no order links when the order link is unknown', () => {
    const mail = sessionReminderMail({ ...input, orderUrl: null, files: [{ name: 'list.pdf', url: null }] });
    expect(mail.text).not.toContain('curios.my/kek');
    expect(mail.text).toContain('list.pdf');
  });
});
