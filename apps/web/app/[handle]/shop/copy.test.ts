import { describe, expect, it } from 'vitest';
import { shopCopy } from './copy.js';

describe('shopCopy', () => {
  it('speaks Malay on a Malay page and English otherwise', () => {
    expect(shopCopy('ms').visit).toBe('Lawati kedai');
    expect(shopCopy('en').visit).toBe('Visit shop');
    expect(shopCopy('fr').visit).toBe('Visit shop');
  });
  it('counts items in each language', () => {
    expect(shopCopy('en').itemCount(1)).toBe('1 item');
    expect(shopCopy('en').itemCount(8)).toBe('8 items');
    expect(shopCopy('ms').itemCount(8)).toBe('8 barang');
  });
  it('says the notice and the closed days, singular and plural, and leaves out closed when there are none', () => {
    expect(shopCopy('en').dayHint(2, [0])).toBe('2 days’ notice · closed Sundays');
    expect(shopCopy('en').dayHint(1, [])).toBe('1 day’s notice');
    expect(shopCopy('en').dayHint(0, [])).toBe('Same-day orders welcome');
    expect(shopCopy('en').dayHint(3, [0, 6])).toBe('3 days’ notice · closed Saturdays and Sundays');
    expect(shopCopy('en').dayHint(2, [5, 0, 6])).toBe('2 days’ notice · closed Fridays, Saturdays and Sundays');
    expect(shopCopy('ms').dayHint(2, [0])).toBe('Notis 2 hari · tutup hari Ahad');
    expect(shopCopy('ms').dayHint(2, [0, 6])).toBe('Notis 2 hari · tutup hari Sabtu dan Ahad');
  });
  it('says, as the board does, that the name and number go to the shop only', () => {
    expect(shopCopy('en').consent('Kek Lina')).toBe('Your name and number go to Kek Lina only.');
    expect(shopCopy('ms').consent('Kek Lina')).toBe('Nama dan nombor anda hanya pergi kepada Kek Lina.');
  });
  it('words the order page’s statuses in both languages, naming the shop', () => {
    expect(shopCopy('en').statusChecking('Kek Lina')).toBe('Receipt sent · Kek Lina is checking');
    expect(shopCopy('en').statusPaid('Kek Lina')).toBe('Paid · Kek Lina is getting it ready');
    expect(shopCopy('en').notReceived('Kek Lina')).toBe('Kek Lina didn’t receive your payment. Pay again and upload the new receipt.');
    expect(shopCopy('ms').statusWaiting).toBe('Menunggu bayaran');
    expect(shopCopy('ms').whatsappAbout('Kek Lina')).toBe('WhatsApp Kek Lina tentang tempahan ini');
    expect(shopCopy('en').statusRefundDue).toBe('Cancelled · refund due');
    expect(shopCopy('ms').statusRefundDue).toBe('Dibatalkan · wang akan dipulangkan');
  });
  it('names a day as its pill and its summary show it', () => {
    expect(shopCopy('en').dayPill('2026-10-17')).toBe('Sat 17');
    expect(shopCopy('en').dayLong('2026-10-17')).toBe('Sat 17 Oct');
    expect(shopCopy('ms').dayPill('2026-10-17')).toBe('Sab 17');
    expect(shopCopy('ms').dayLong('2026-10-17')).toBe('Sab 17 Okt');
  });
  it('words the shop page in both languages', () => {
    expect(shopCopy('en').openForOrders).toBe('Open for orders');
    expect(shopCopy('ms').openForOrders).toBe('Buka untuk tempahan');
    expect(shopCopy('en').barPickup('Sat 17 Oct')).toBe('Pickup Sat 17 Oct');
    expect(shopCopy('ms').barPickup('Sab 17 Okt')).toBe('Ambil Sab 17 Okt');
    expect(shopCopy('en').factNextPickup('Sat 17 Oct')).toBe('Next pickup Sat 17 Oct');
  });
  it('words the product page in both languages', () => {
    const en = shopCopy('en');
    const ms = shopCopy('ms');
    expect(en.productNotice(2, 'Sat 17 Oct', true)).toBe('Needs 2 days. Earliest pickup Sat 17 Oct.');
    expect(en.productNotice(1, 'Sat 17 Oct', false)).toBe('Needs 1 day. Earliest delivery Sat 17 Oct.');
    expect(en.productNotice(0, null, true)).toBeNull();
    expect(ms.productNotice(2, 'Sab 17 Okt', true)).toBe('Perlu 2 hari. Awal ambil Sab 17 Okt.');
    expect(ms.productNotice(2, null, false)).toBe('Perlu 2 hari.');
    expect(en.addToBasket('RM95')).toBe('Add to basket · RM95');
    expect(ms.addToBasket('RM95')).toBe('Masuk bakul · RM95');
    expect(en.askPrefill('Kek')).toBe('I have a question about Kek.');
    expect(ms.askPrefill('Kek')).toBe('Saya ada soalan tentang Kek.');
  });
});
