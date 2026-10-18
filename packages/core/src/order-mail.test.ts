import { describe, expect, it } from 'vitest';
import { OWNER_MAIL_FOOTER } from './mail.js';
import { newOrderMail } from './order-mail.js';

const order = {
  number: 12,
  totalCents: 19_000,
  customerName: 'Aisyah',
  phone: '+60123456789',
  method: 'PICKUP' as const,
  // A Saturday.
  day: '2026-10-17',
  note: 'Tulis “Selamat Hari Jadi Mak” please',
  lines: [
    { itemName: 'Kek coklat moist', optionLabel: '2kg', quantity: 1, lineCents: 17_000 },
    { itemName: 'Tart nenas', optionLabel: null, quantity: 2, lineCents: 2_000 },
  ],
  url: 'https://curios.my/app/orders?order=ord_1',
};

describe('newOrderMail', () => {
  it('says the order number and total in the subject', () => {
    expect(newOrderMail(order).subject).toBe('New order #12 · RM190');
  });

  it('heads the email with who ordered and how much', () => {
    const mail = newOrderMail(order);
    expect(mail.html).toContain('>Aisyah ordered RM190 from your shop</h1>');
    expect(mail.text).toContain('Aisyah ordered RM190 from your shop');
  });

  it('says they pay the owner directly, naming no method and no pronoun', () => {
    const mail = newOrderMail(order);
    const said = 'They pay you directly, by your QR or bank transfer. We’ll email you again when their receipt comes in.';
    expect(mail.text).toContain(said);
    expect(mail.html).toContain(said);
  });

  it('lists the lines and the total', () => {
    const mail = newOrderMail(order);
    expect(mail.html).toContain('Kek coklat moist');
    expect(mail.html).toContain('2kg · 1×');
    expect(mail.html).toContain('RM170');
    expect(mail.html).toContain('Tart nenas');
    expect(mail.html).toContain('2×');
    expect(mail.html).toContain('RM20');
    expect(mail.html).toContain('>Total<');
    expect(mail.html).toContain('>RM190<');
    expect(mail.text).toContain('Kek coklat moist, 2kg, 1×: RM170');
    expect(mail.text).toContain('Total: RM190');
  });

  it('says how they get it, who they are and their note', () => {
    const mail = newOrderMail(order);
    expect(mail.html).toContain('>Getting it<');
    expect(mail.html).toContain('Pickup · Sat 17 Oct');
    expect(mail.html).toContain('>Customer<');
    expect(mail.html).toContain('Aisyah · +60 12-345 6789');
    expect(mail.html).toContain('>Note<');
    expect(mail.html).toContain('Tulis “Selamat Hari Jadi Mak” please');
    expect(newOrderMail({ ...order, method: 'DELIVERY' }).html).toContain('Delivery · Sat 17 Oct');
  });

  it('leaves the note out when there is none', () => {
    expect(newOrderMail({ ...order, note: null }).html).not.toContain('>Note<');
  });

  it('links the button to the order', () => {
    const mail = newOrderMail(order);
    expect(mail.html).toContain('href="https://curios.my/app/orders?order=ord_1"');
    expect(mail.html).toContain('>Open order #12</a>');
    expect(mail.text).toContain('https://curios.my/app/orders?order=ord_1');
  });

  it('says why it came', () => {
    expect(newOrderMail(order).html).toContain(OWNER_MAIL_FOOTER);
  });

  it('escapes every value a customer typed', () => {
    const mail = newOrderMail({
      ...order,
      customerName: '<b>Ali</b>',
      note: '<script>alert(1)</script>',
      lines: [{ itemName: '<i>Kek</i>', optionLabel: '<u>2kg</u>', quantity: 1, lineCents: 19_000 }],
    });
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).not.toContain('<b>Ali');
    expect(mail.html).not.toContain('<i>Kek');
    expect(mail.html).not.toContain('<u>2kg');
    expect(mail.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(mail.html).toContain('&lt;b&gt;Ali&lt;/b&gt; ordered RM190');
    expect(mail.html).toContain('&lt;i&gt;Kek&lt;/i&gt;');
    expect(mail.html).toContain('&lt;u&gt;2kg&lt;/u&gt;');
  });
});
