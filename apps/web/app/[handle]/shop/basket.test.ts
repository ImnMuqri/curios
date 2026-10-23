import { describe, expect, it } from 'vitest';
import { shopCopy } from './copy.js';
import { addToBasket, basketMessage, priceBasket, QUANTITY_MAX, whatsappNumber, whatsappOrderUrl } from './basket.js';

const items = [
  { id: 'cake', name: 'Kek Batik', slug: 'cake', category: null, tag: null, description: null, photoKey: null, priceCents: null, options: [{ id: 'k1', label: '1kg', priceCents: 9500 }, { id: 'k2', label: '2kg', priceCents: 17000 }] },
  { id: 'cookie', name: 'Cookies balang', slug: 'cookie', category: null, tag: null, description: null, photoKey: null, priceCents: 2500, options: [] },
];

describe('priceBasket', () => {
  it('prices each line from the current shelf and totals them', () => {
    const priced = priceBasket([{ itemId: 'cake', optionId: 'k2', quantity: 2 }, { itemId: 'cookie', optionId: null, quantity: 1 }], items);
    expect(priced.totalCents).toBe(36500);
    expect(priced.lines.map((l) => [l.name, l.optionLabel, l.lineCents])).toEqual([['Kek Batik', '2kg', 34000], ['Cookies balang', null, 2500]]);
  });
  it('drops lines whose item or option has left the shelf', () => {
    const priced = priceBasket([{ itemId: 'gone', optionId: null, quantity: 1 }, { itemId: 'cake', optionId: 'k9', quantity: 1 }, { itemId: 'cookie', optionId: 'k1', quantity: 1 }], items);
    expect(priced.lines).toEqual([]);
  });
  it('drops a priced-by-option item with no option chosen, and a zero quantity', () => {
    const priced = priceBasket([{ itemId: 'cake', optionId: null, quantity: 1 }, { itemId: 'cookie', optionId: null, quantity: 0 }], items);
    expect(priced.lines).toEqual([]);
    expect(priced.totalCents).toBe(0);
  });
});

describe('whatsappNumber', () => {
  it('finds the number in a wa.me link or an api.whatsapp.com link', () => {
    expect(whatsappNumber([{ label: 'IG', url: 'https://instagram.com/x' }, { label: 'WA', url: 'https://wa.me/60123456789' }])).toBe('60123456789');
    expect(whatsappNumber([{ label: 'WA', url: 'https://api.whatsapp.com/send?phone=60123456789' }])).toBe('60123456789');
  });
  it('is null when the page has no WhatsApp number', () => {
    expect(whatsappNumber([{ label: 'IG', url: 'https://instagram.com/x' }])).toBeNull();
    expect(whatsappNumber([{ label: 'WA', url: 'https://whatsapp.com/channel/abc' }])).toBeNull();
    expect(whatsappNumber([{ label: 'bad', url: 'not a url' }])).toBeNull();
    expect(whatsappNumber([{ label: 'WA', url: 'https://whatsapp.com/channel/0029Va12345678' }])).toBeNull();
  });
  it('reads digits only from a real number path, never from a business message or QR code', () => {
    const wa = (url: string) => whatsappNumber([{ label: 'WA', url }]);
    expect(wa('https://wa.me/message/AB12345678CD')).toBeNull();
    expect(wa('https://wa.me/qr/12345678ABC')).toBeNull();
    expect(wa('https://wa.me/c/60123456789')).toBe('60123456789');
    expect(wa('https://wa.me/60123456789/')).toBe('60123456789');
    expect(wa('https://wa.me/+60123456789')).toBe('60123456789');
    expect(wa('https://wa.me/1234567890123456')).toBeNull();
    expect(wa('https://api.whatsapp.com/send?phone=1234567890123456')).toBeNull();
  });
});

describe('basketMessage', () => {
  it('lists each line and the total, in the page language', () => {
    const priced = priceBasket([{ itemId: 'cake', optionId: 'k1', quantity: 2 }], items);
    expect(basketMessage('Kek Lina', priced, shopCopy('ms'))).toBe('Hai Kek Lina, saya nak tempah:\n• 2 × Kek Batik (1kg) — RM190\nJumlah: RM190');
  });
  it('encodes the message into the link', () => {
    expect(whatsappOrderUrl('60123456789', 'Hi & bye')).toBe('https://wa.me/60123456789?text=Hi%20%26%20bye');
  });
});

describe('addToBasket', () => {
  it('adds a new line, and adds to a line for the same item and option', () => {
    const one = addToBasket([], { itemId: 'cake', optionId: 'k1', quantity: 1 });
    expect(one).toEqual([{ itemId: 'cake', optionId: 'k1', quantity: 1 }]);
    const two = addToBasket(one, { itemId: 'cake', optionId: 'k1', quantity: 2 });
    expect(two).toEqual([{ itemId: 'cake', optionId: 'k1', quantity: 3 }]);
    expect(addToBasket(two, { itemId: 'cake', optionId: 'k2', quantity: 1 })).toHaveLength(2);
  });

  it('never holds more of one line than the API takes, however it is added', () => {
    expect(QUANTITY_MAX).toBe(99);
    const full = addToBasket([{ itemId: 'cake', optionId: 'k1', quantity: 98 }], { itemId: 'cake', optionId: 'k1', quantity: 5 });
    expect(full).toEqual([{ itemId: 'cake', optionId: 'k1', quantity: 99 }]);
    expect(addToBasket(full, { itemId: 'cake', optionId: 'k1', quantity: 1 })[0]?.quantity).toBe(99);
    expect(addToBasket([], { itemId: 'cookie', optionId: null, quantity: 150 })[0]?.quantity).toBe(99);
  });
});
