import { describe, expect, it } from 'vitest';
import { leadPush, newOrderPush, paidOrderPush, receiptPush, testPush } from './push.js';

const url = 'https://curios.my/app/orders?order=o1';

describe('the owner push notifications', () => {
  it('says a new order with its number, who and how much', () => {
    expect(newOrderPush({ number: 15, customerName: 'Aisha', totalCents: 4550, url })).toEqual({
      title: 'New order #15',
      body: 'Aisha · RM45.50',
      url,
      tag: 'order-15',
    });
  });

  it('says an order that came with its receipt is ready to check', () => {
    expect(newOrderPush({ number: 15, customerName: 'Aisha', totalCents: 4550, url, receipt: true })).toEqual({
      title: 'New order #15 · receipt to check',
      body: 'Aisha · RM45.50. Check the receipt and mark it paid.',
      url,
      tag: 'order-15',
    });
  });

  // One order, one notification on the lock screen: a payment replaces the "new order" before it.
  it('tells an online payment under the same tag as the order', () => {
    expect(paidOrderPush({ number: 15, customerName: 'Aisha', totalCents: 4550, kind: 'paid', url })).toMatchObject({
      title: 'Order #15 is paid',
      body: 'Aisha paid RM45.50 online.',
      tag: 'order-15',
    });
    expect(paidOrderPush({ number: 15, customerName: 'Aisha', totalCents: 4550, kind: 'paid-after-cancel', url }).title).toBe('Order #15 was paid after you cancelled it');
    expect(paidOrderPush({ number: 15, customerName: 'Aisha', totalCents: 4550, kind: 'paid-twice', url }).title).toBe('Order #15 was paid twice');
  });

  it('asks the owner to check a receipt', () => {
    expect(receiptPush({ number: 7, customerName: 'Daniel', totalCents: 12000, url })).toMatchObject({
      title: 'Receipt for order #7',
      body: 'Daniel · RM120. Check it and mark it paid.',
      tag: 'order-7',
    });
  });

  // A lock screen is read by whoever holds the phone: the number stays in the app.
  it('says who left their number and what about, never the number itself', () => {
    const push = leadPush({ name: 'Farah', about: 'Birthday cake', url: 'https://curios.my/app/leads' });
    expect(push).toMatchObject({ title: 'Farah left their number', body: 'About: Birthday cake. Reply while it’s warm.' });
    expect(leadPush({ name: null, about: null, url: 'https://curios.my/app/leads' })).toMatchObject({
      title: 'Someone left their number',
      body: 'Open Leads to reply while it’s warm.',
    });
  });

  it('cuts a name too long for a lock screen', () => {
    const name = 'A'.repeat(80);
    expect(newOrderPush({ number: 1, customerName: name, totalCents: 100, url }).body.length).toBeLessThan(60);
  });

  it('has a test that says it worked', () => {
    expect(testPush('https://curios.my/app/settings')).toMatchObject({ title: 'Notifications are on', tag: 'test' });
  });
});
