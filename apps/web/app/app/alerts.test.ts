import { describe, expect, it } from 'vitest';
import { FREE_LEADS, FREE_ORDERS, orderState, planState } from '@curios/core';
import { alertsFor, billingNeedsYou } from './alerts.js';

const NOW = new Date('2026-10-15T04:00:00.000Z');
const plan = (page: { mode?: 'PERSONAL' | 'BUSINESS'; paidUntil?: Date | null; leadsCaptured?: number } = {}) =>
  planState({ mode: page.mode ?? 'BUSINESS', paidUntil: page.paidUntil ?? null, leadsCaptured: page.leadsCaptured ?? 0, now: NOW });
const quiet = { used: 10, cap: 200 };
const shop = (page: { mode?: 'PERSONAL' | 'BUSINESS'; paidUntil?: Date | null; ordersPlaced?: number; storeEnabled?: boolean } = {}) => ({
  state: orderState({ mode: page.mode ?? 'BUSINESS', paidUntil: page.paidUntil ?? null, ordersPlaced: page.ordersPlaced ?? 0, ordersAtTrialReset: 0, now: NOW }),
  storeEnabled: page.storeEnabled ?? true,
});
const paid = plan({ paidUntil: new Date('2099-01-01T00:00:00.000Z') });

describe('alertsFor', () => {
  it('counts a running trial on Leads, in blue, one segment per free lead', () => {
    const [alert] = alertsFor({ plan: plan({ leadsCaptured: 1 }), usage: quiet, now: NOW });

    expect(alert).toMatchObject({
      id: 'trial-1',
      tone: 'info',
      where: '/app/leads',
      title: '1 of your 3 free leads used',
      text: 'After 3, the capture card stops appearing on your page until you subscribe.',
      meter: [true, false, false],
      action: { href: '/app/billing', label: 'See plans' },
    });
  });

  it('comes back after a dismissal once another lead is used: the id carries the count', () => {
    const [one] = alertsFor({ plan: plan({ leadsCaptured: 1 }), usage: quiet, now: NOW });
    const [two] = alertsFor({ plan: plan({ leadsCaptured: 2 }), usage: quiet, now: NOW });
    expect(one?.id).not.toBe(two?.id);
  });

  it('says a used-up trial has stopped the capture card, in amber, and nothing else has', () => {
    const [alert] = alertsFor({ plan: plan({ leadsCaptured: FREE_LEADS }), usage: quiet, now: NOW });

    expect(alert).toMatchObject({
      tone: 'warn',
      where: '/app/leads',
      title: 'Your 3 free leads are used',
      text: 'The capture card is no longer shown on your page. Everything else still works: your page, your FAQ pages and the chat.',
      action: { label: 'See your options' },
    });
  });

  it('puts an ended plan on every screen, in red, dated on the Malaysian calendar', () => {
    const [alert] = alertsFor({
      plan: plan({ leadsCaptured: FREE_LEADS, paidUntil: new Date('2026-10-13T20:00:00.000Z') }),
      usage: quiet,
      now: NOW,
    });

    expect(alert).toMatchObject({
      tone: 'stop',
      where: 'all',
      title: 'Your Business plan ended on 14 Oct 2026',
      action: { label: 'Renew your plan' },
    });
  });

  it('says both halves when a plan ended with free leads left: it ended, and capture has not stopped yet', () => {
    const [alert] = alertsFor({ plan: plan({ leadsCaptured: 1, paidUntil: new Date('2026-10-01T00:00:00.000Z') }), usage: quiet, now: NOW });

    expect(alert?.tone).toBe('stop');
    expect(alert?.title).toBe('Your Business plan ended on 1 Oct 2026');
    expect(alert?.text).toContain('You have 2 free leads left.');
  });

  it('says nothing about the plan for a paid page or a personal one', () => {
    expect(alertsFor({ plan: plan({ paidUntil: new Date('2099-01-01T00:00:00.000Z') }), usage: quiet, now: NOW })).toEqual([]);
    expect(alertsFor({ plan: plan({ mode: 'PERSONAL' }), usage: quiet, now: NOW })).toEqual([]);
  });

  it('warns near the limit, at about 80%, on Questions, in blue', () => {
    const alerts = alertsFor({ plan: plan({ mode: 'PERSONAL' }), usage: { used: 164, cap: 200 }, now: NOW });

    expect(alerts).toEqual([
      expect.objectContaining({
        id: 'near-2026-10',
        tone: 'info',
        where: '/app/questions',
        title: '164 of 200 conversations used this month',
        text: 'At 200 the chat gives a short fixed reply until 1 Nov. Your links keep working.',
        meter: [true, true, true, true, false],
      }),
    ]);
    expect(alertsFor({ plan: plan({ mode: 'PERSONAL' }), usage: { used: 159, cap: 200 }, now: NOW })).toEqual([]);
  });

  it('says the limit is reached in amber, from the cap in force rather than a written-in 200', () => {
    const [alert] = alertsFor({ plan: plan({ mode: 'PERSONAL' }), usage: { used: 2000, cap: 2000 }, now: NOW });

    expect(alert).toMatchObject({
      tone: 'warn',
      title: 'Your page answered 2,000 conversations this month',
      text: 'Until 1 Nov, the chat gives a short fixed reply and points people to your links. Nothing extra is charged. New questions still land here.',
      meter: [true, true, true, true, true],
    });
  });

  it('lists the every-screen one first', () => {
    const alerts = alertsFor({
      plan: plan({ leadsCaptured: FREE_LEADS, paidUntil: new Date('2026-10-01T00:00:00.000Z') }),
      usage: { used: 200, cap: 200 },
      now: NOW,
    });
    expect(alerts.map((a) => a.where)).toEqual(['all', '/app/questions']);
  });
});

describe('alertsFor, the shop', () => {
  it('pauses an open shop whose free orders are used, in red, on Orders', () => {
    const alerts = alertsFor({ plan: paid, usage: quiet, now: NOW, orders: shop({ ordersPlaced: FREE_ORDERS }) });

    expect(alerts).toEqual([
      expect.objectContaining({
        id: 'paused',
        tone: 'stop',
        where: '/app/orders',
        icon: 'shop',
        title: 'Your shop can’t take orders right now',
        text: 'Your 3 free orders are used. Customers can still see your shop, and their basket comes to you on WhatsApp instead.',
        action: { href: '/app/billing', label: 'Pay to take orders' },
      }),
    ]);
  });

  it('says when the plan ended, for a shop paused by a lapsed plan', () => {
    const [alert] = alertsFor({
      plan: paid,
      usage: quiet,
      now: NOW,
      orders: shop({ ordersPlaced: FREE_ORDERS, paidUntil: new Date('2026-10-13T20:00:00.000Z') }),
    });

    expect(alert).toMatchObject({
      tone: 'stop',
      where: '/app/orders',
      title: 'Your shop can’t take orders right now',
      text: 'Your Business plan ended on 14 Oct 2026. Customers can still see your shop, and their basket comes to you on WhatsApp instead.',
      action: { label: 'Pay to take orders' },
    });
  });

  it('counts the free orders on Orders, in blue, while the trial runs', () => {
    const [alert] = alertsFor({ plan: paid, usage: quiet, now: NOW, orders: shop({ ordersPlaced: 1 }) });

    expect(alert).toMatchObject({
      id: 'orders-trial-1',
      tone: 'info',
      where: '/app/orders',
      icon: 'shop',
      title: '1 of your 3 free orders used',
      text: 'After 3, checkout pauses and baskets come to you on WhatsApp until you subscribe.',
      meter: [true, false, false],
      action: { href: '/app/billing', label: 'See plans' },
    });
  });

  it('says nothing about orders for a shop that is off, a paid one, or a personal page', () => {
    expect(alertsFor({ plan: paid, usage: quiet, now: NOW, orders: shop({ ordersPlaced: FREE_ORDERS, storeEnabled: false }) })).toEqual([]);
    expect(alertsFor({ plan: paid, usage: quiet, now: NOW, orders: shop({ ordersPlaced: 9, paidUntil: new Date('2099-01-01T00:00:00.000Z') }) })).toEqual([]);
    expect(alertsFor({ plan: plan({ mode: 'PERSONAL' }), usage: quiet, now: NOW, orders: shop({ mode: 'PERSONAL' }) })).toEqual([]);
  });
});

describe('billingNeedsYou', () => {
  it('dots Billing for a paused shop too', () => {
    expect(billingNeedsYou(paid, shop({ ordersPlaced: FREE_ORDERS }))).toBe(true);
    expect(billingNeedsYou(paid, shop({ ordersPlaced: FREE_ORDERS, storeEnabled: false }))).toBe(false);
    expect(billingNeedsYou(paid, shop({ ordersPlaced: 1 }))).toBe(false);
  });

  it('dots Billing for a used-up trial or an ended plan, and not otherwise', () => {
    expect(billingNeedsYou(plan({ leadsCaptured: FREE_LEADS }))).toBe(true);
    expect(billingNeedsYou(plan({ leadsCaptured: FREE_LEADS, paidUntil: new Date('2026-10-01T00:00:00.000Z') }))).toBe(true);
    expect(billingNeedsYou(plan({ leadsCaptured: 1, paidUntil: new Date('2026-10-01T00:00:00.000Z') }))).toBe(true);
    expect(billingNeedsYou(plan({ leadsCaptured: 1 }))).toBe(false);
    expect(billingNeedsYou(plan({ paidUntil: new Date('2099-01-01T00:00:00.000Z') }))).toBe(false);
  });
});
