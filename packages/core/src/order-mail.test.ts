import { describe, expect, it } from 'vitest';
import { OWNER_MAIL_FOOTER } from './mail.js';
import { newOrderMail, paidAfterCancelMail, paidOrderMail, paidTwiceMail, receiptMail } from './order-mail.js';

const order = {
  number: 12,
  totalCents: 19_000,
  customerName: 'Aisyah',
  phone: '+60123456789',
  method: 'PICKUP' as const,
  deliveryCents: 0,
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

  // A flat fee is always above RM0, so a delivery with none added is a rider's.
  it('says a rider delivery’s fee is paid separately, in Getting it, as checkout does', () => {
    const rider = newOrderMail({ ...order, method: 'DELIVERY', deliveryCents: 0 });
    expect(rider.html).toContain('Delivery · Sat 17 Oct · Rider fee paid separately');
    expect(rider.text).toContain('Getting it: Delivery · Sat 17 Oct · Rider fee paid separately');
    expect(newOrderMail({ ...order, method: 'DELIVERY', deliveryCents: 800 }).html).not.toContain('Rider fee');
    expect(newOrderMail(order).html).not.toContain('Rider fee');
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

describe('receiptMail', () => {
  const receipt = {
    number: 12,
    totalCents: 19_000,
    customerName: 'Aisyah',
    // 3:42pm in Malaysia, Thu 15 Oct.
    uploadedAt: new Date('2026-10-15T07:42:00Z'),
    fileName: 'a1b2c3.jpg',
    url: 'https://curios.my/app/orders?order=ord_1',
  };

  it('says the order number in the subject and who sent it in the heading', () => {
    const mail = receiptMail(receipt);
    expect(mail.subject).toBe('Receipt uploaded for #12');
    expect(mail.html).toContain('>Aisyah sent a receipt for order #12</h1>');
    expect(mail.text).toContain('Aisyah sent a receipt for order #12');
  });

  it('says what to check, and that not receiving the money is a button away', () => {
    const mail = receiptMail(receipt);
    const small = 'Didn’t get the money? Open the order and mark it as not received. Aisyah will be asked to try again.';
    expect(mail.html).toContain('Check that RM190 reached your account, then confirm the order.');
    expect(mail.html).toContain(small);
    expect(mail.text).toContain(small);
  });

  it('lists the order, sender, time in Malaysia and file', () => {
    const mail = receiptMail(receipt);
    expect(mail.html).toContain('#12 · RM190');
    expect(mail.html).toContain('Thu 15 Oct, 3:42pm');
    expect(mail.html).toContain('a1b2c3.jpg');
    expect(mail.text).toContain('Sent: Thu 15 Oct, 3:42pm');
  });

  it('links the button to the order', () => {
    const mail = receiptMail(receipt);
    expect(mail.html).toContain('href="https://curios.my/app/orders?order=ord_1"');
    expect(mail.html).toContain('>Check the receipt</a>');
    expect(mail.html).toContain(OWNER_MAIL_FOOTER);
  });

  it('escapes the customer name', () => {
    const mail = receiptMail({ ...receipt, customerName: '<b>Ali</b>' });
    expect(mail.html).not.toContain('<b>Ali');
    expect(mail.html).toContain('&lt;b&gt;Ali&lt;/b&gt; sent a receipt');
  });
});

describe('the wordmark host', () => {
  it('comes from appUrl in the new-order and receipt emails, not from production', () => {
    const appUrl = 'http://localhost:3000/';
    expect(newOrderMail({ ...order, appUrl }).html).toContain('src="http://localhost:3000/email/wordmark@2x.png"');
    const receipt = receiptMail({ number: 12, totalCents: 19_000, customerName: 'Aisyah', uploadedAt: new Date('2026-10-15T07:42:00Z'), fileName: 'r.jpg', url: 'https://curios.my/x', appUrl });
    expect(receipt.html).toContain('src="http://localhost:3000/email/wordmark@2x.png"');
  });
});

describe('paidOrderMail', () => {
  const paid = {
    number: 14,
    totalCents: 21_500,
    customerName: 'Nurul',
    phone: '+60137782041',
    method: 'PICKUP' as const,
    deliveryCents: 0,
    day: '2026-10-17',
    via: 'FPX · Maybank2u',
    ref: 'CHIP-4K2X' as string | null,
    lines: [
      { itemName: 'Kek coklat moist', optionLabel: '2kg', quantity: 1, lineCents: 17_000 },
      { itemName: 'Kek batik', optionLabel: 'Box of 12', quantity: 1, lineCents: 4_500 },
    ],
    url: 'https://curios.my/app/orders?order=ord_14',
    appUrl: 'https://curios.my',
  };

  it('says paid in the subject', () => {
    expect(paidOrderMail(paid).subject).toBe('New order #14 · RM215 · Paid');
  });

  it('tags it Paid by the first part of how, and heads it with who paid how much', () => {
    const mail = paidOrderMail(paid);
    expect(mail.html).toContain('Paid by FPX</span>');
    expect(mail.html).not.toContain('Paid by FPX ·');
    expect(mail.html).toContain('>Nurul ordered and paid RM215</h1>');
    expect(mail.text).toContain('Nurul ordered and paid RM215');
  });

  it('says there is nothing to check, and names the weekday to get it ready for', () => {
    const said = 'The bank confirmed it through CHIP, so there’s nothing to check. Just get it ready for Saturday.';
    const mail = paidOrderMail(paid);
    expect(mail.html).toContain(said);
    expect(mail.text).toContain(said);
  });

  it('labels the lines total Paid, and has no receipt line or note', () => {
    const mail = paidOrderMail(paid);
    expect(mail.html).toContain('>Paid<');
    expect(mail.html).not.toContain('>Total<');
    expect(mail.html).toContain('>RM215<');
    expect(mail.html).not.toMatch(/receipt/i);
    expect(mail.html).not.toContain('>Note<');
    expect(mail.text).toContain('Paid: RM215');
  });

  it('gives how they get it, who they are, and how they paid with the reference', () => {
    const mail = paidOrderMail(paid);
    expect(mail.html).toContain('Pickup · Sat 17 Oct');
    expect(mail.html).toContain('Nurul · +60 13-778 2041');
    expect(mail.html).toContain('>Paid with<');
    expect(mail.html).toContain('FPX · Maybank2u · Ref CHIP-4K2X');
    expect(mail.text).toContain('Paid with: FPX · Maybank2u · Ref CHIP-4K2X');
  });

  it('leaves the reference out when CHIP gave none', () => {
    const mail = paidOrderMail({ ...paid, ref: null });
    expect(mail.html).toContain('>FPX · Maybank2u</td>');
    expect(mail.html).not.toContain('Ref ');
  });

  it('opens the order, and says where the money is', () => {
    const mail = paidOrderMail(paid);
    expect(mail.html).toContain('>Open order #14</a>');
    expect(mail.html).toContain('href="https://curios.my/app/orders?order=ord_14"');
    const small = 'The money is in your CHIP account. CHIP pays it out to your bank on its usual schedule.';
    expect(mail.html).toContain(small);
    expect(mail.text).toContain(small);
    expect(mail.html).toContain(OWNER_MAIL_FOOTER);
  });

  it('uses the app host for the wordmark', () => {
    expect(paidOrderMail({ ...paid, appUrl: 'http://localhost:3000' }).html).toContain('src="http://localhost:3000/email/wordmark@2x.png"');
  });
});

describe('paidAfterCancelMail', () => {
  const late = { number: 14, totalCents: 21_500, customerName: 'Nurul', via: 'FPX · Maybank2u', url: 'https://curios.my/app/orders?order=ord_14', appUrl: 'https://curios.my' };

  it('says the order was paid after it was cancelled', () => {
    expect(paidAfterCancelMail(late).subject).toBe('Order #14 was paid after you cancelled it');
  });

  it('says what to do: refund in CHIP, then mark it refunded', () => {
    const mail = paidAfterCancelMail(late);
    const said = 'Nurul paid RM215 by FPX · Maybank2u after you cancelled it. Refund them in CHIP, then mark it refunded in Orders.';
    expect(mail.html).toContain(said);
    expect(mail.text).toContain(said);
    expect(mail.html).toContain('>Open order #14</a>');
  });
});

describe('paidTwiceMail', () => {
  const twice = { number: 14, totalCents: 21_500, customerName: 'Nurul', via: 'FPX · Maybank2u', first: 'qr' as const, url: 'https://curios.my/app/orders?order=ord_14', appUrl: 'https://curios.my' };

  it('says the order was paid twice, and which two ways', () => {
    const mail = paidTwiceMail(twice);
    expect(mail.subject).toBe('Order #14 was paid twice');
    const said = 'Nurul paid RM215 by FPX · Maybank2u on top of the QR payment. Refund one of them in CHIP.';
    expect(mail.html).toContain(said);
    expect(mail.text).toContain(said);
    expect(mail.text).toContain('Open order #14: https://curios.my/app/orders?order=ord_14');
    expect(mail.html).toContain('>Open order #14</a>');
  });

  it('names a payment the owner marked by hand', () => {
    expect(paidTwiceMail({ ...twice, first: 'hand' }).text).toContain('on top of the hand-marked payment.');
  });
});

describe('a voucher on the order emails', () => {
  const discounted = { ...order, totalCents: 18_050, discountCents: 950, voucherLabel: 'RAYA10' };

  it('newOrderMail shows the voucher and what it took off above the discounted total', () => {
    const mail = newOrderMail(discounted);
    expect(mail.subject).toBe('New order #12 · RM180.50');
    expect(mail.html).toContain('RAYA10');
    expect(mail.html).toContain('−RM9.50');
    expect(mail.html).toContain('>RM180.50<');
    expect(mail.html.indexOf('−RM9.50')).toBeLessThan(mail.html.indexOf('>Total<'));
    expect(mail.text).toContain('RAYA10: −RM9.50');
    expect(mail.text.indexOf('RAYA10: −RM9.50')).toBeLessThan(mail.text.indexOf('Total: RM180.50'));
  });

  it('shows no voucher line without a discount', () => {
    expect(newOrderMail({ ...order, discountCents: 0, voucherLabel: null }).text).not.toContain('−RM');
    expect(newOrderMail(order).html).not.toContain('−RM');
  });

  it('a free order is already paid with a voucher: no receipt to wait for', () => {
    const mail = newOrderMail({ ...order, totalCents: 0, discountCents: 19_000, voucherLabel: 'FREE100', paidWithVoucher: true });
    expect(mail.subject).toBe('New order #12 · RM0 · Paid');
    expect(mail.html).toContain('Paid with a voucher</span>');
    expect(mail.text).toContain('nothing to pay and no receipt to check');
    expect(mail.text).not.toContain('They pay you directly');
    expect(mail.html).not.toContain('Waiting for payment');
    expect(mail.text).toContain('FREE100: −RM190');
    expect(mail.text).toContain('Paid: RM0');
  });

  it('a free digital order says it was sent', () => {
    const mail = newOrderMail({ ...order, method: null, day: null, totalCents: 0, discountCents: 19_000, voucherLabel: 'FREE100', paidWithVoucher: true });
    expect(mail.text).toContain('sent to them straight away');
  });

  it('paidOrderMail shows the voucher above what was paid', () => {
    const mail = paidOrderMail({
      number: 14,
      totalCents: 20_550,
      customerName: 'Nurul',
      phone: '+60137782041',
      method: 'PICKUP',
      deliveryCents: 0,
      day: '2026-10-17',
      via: 'FPX · Maybank2u',
      ref: null,
      lines: [{ itemName: 'Kek coklat moist', optionLabel: '2kg', quantity: 1, lineCents: 21_500 }],
      url: 'https://curios.my/app/orders?order=ord_14',
      discountCents: 950,
      voucherLabel: 'Raya promo',
    });
    expect(mail.html).toContain('Raya promo');
    expect(mail.html).toContain('−RM9.50');
    expect(mail.text).toContain('Raya promo: −RM9.50');
    expect(mail.text).toContain('Paid: RM205.50');
  });
});
