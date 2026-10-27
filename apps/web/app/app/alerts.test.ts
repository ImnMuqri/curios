import { describe, expect, it } from 'vitest';
import { FREE_LEADS, FREE_ORDERS, orderState, planState } from '@curios/core';
import { alertsFor, billingNeedsYou } from './alerts.js';

const NOW = new Date('2026-10-15T04:00:00.000Z');
const plan = (page: { mode?: 'PERSONAL' | 'BUSINESS'; paidUntil?: Date | null; leadsCaptured?: number } = {}) =>
  planState({ mode: page.mode ?? 'BUSINESS', paidUntil: page.paidUntil ?? null, leadsCaptured: page.leadsCaptured ?? 0, now: NOW });
const quiet = { used: 10, cap: 200 };
/** The allowances in force: the defaults, as a database with no rows gives. */
const free = { freeLeads: FREE_LEADS, freeOrders: FREE_ORDERS };
const shop = (page: { mode?: 'PERSONAL' | 'BUSINESS'; paidUntil?: Date | null; ordersPlaced?: number; storeEnabled?: boolean } = {}) => ({
  state: orderState({ mode: page.mode ?? 'BUSINESS', paidUntil: page.paidUntil ?? null, ordersPlaced: page.ordersPlaced ?? 0, ordersAtTrialReset: 0, now: NOW }),
  storeEnabled: page.storeEnabled ?? true,
});
/** One page, read the way layout.tsx reads it: the plan and the shop from the same row, so every pairing is a real one. */
const page = (
  p: { mode?: 'PERSONAL' | 'BUSINESS'; paidUntil?: Date | null; leadsCaptured?: number; ordersPlaced?: number; storeEnabled?: boolean } = {},
) => ({
  plan: plan(p),
  usage: quiet,
  now: NOW,
  orders: shop(p),
  ...free,
});

describe('the Curios team’s banner', () => {
  it('is an info alert for every screen, with the banner text, first, and nothing to dismiss', () => {
    const alerts = alertsFor({ ...page({ leadsCaptured: 3 }), banner: 'Payments are slow this morning. Orders still come through.' });

    expect(alerts[0]).toEqual({
      id: 'banner',
      tone: 'info',
      where: 'all',
      icon: 'chat',
      title: 'From the Curios team',
      text: 'Payments are slow this morning. Orders still come through.',
      fixed: true,
    });
    expect(alerts.length).toBeGreaterThan(1);
  });

  it('goes ahead of a suspension too, because it is first', () => {
    const alerts = alertsFor({ ...page(), suspension: { reason: 'x' }, banner: 'Hello' });
    expect(alerts.map((a) => a.id).slice(0, 2)).toEqual(['banner', 'suspended']);
  });

  it('adds nothing when there is no banner', () => {
    expect(alertsFor({ ...page(), banner: null }).some((a) => a.id === 'banner')).toBe(false);
    expect(alertsFor(page()).some((a) => a.id === 'banner')).toBe(false);
  });
});

describe('a suspended page', () => {
  const suspension = { reason: 'Customers reported being asked to pay before an order.' };

  it('puts a red alert on every screen with the reason as its text, and Contact support as its action', () => {
    const alerts = alertsFor({ ...page(), suspension });

    expect(alerts[0]).toEqual({
      id: 'suspended',
      tone: 'stop',
      where: 'all',
      icon: 'page',
      title: 'Your page is suspended',
      text: 'Customers reported being asked to pay before an order.',
      action: { href: 'mailto:support@curios.my', label: 'Contact support' },
    });
  });

  it('comes before the plan alerts, and is gone once the page is brought back', () => {
    const lapsed = page({ leadsCaptured: FREE_LEADS, paidUntil: new Date('2026-10-13T20:00:00.000Z') });
    expect(alertsFor({ ...lapsed, suspension }).map((a) => a.id)[0]).toBe('suspended');
    expect(alertsFor(lapsed).map((a) => a.id)).not.toContain('suspended');
  });

  it('still says something when no reason was kept', () => {
    expect(alertsFor({ ...page(), suspension: { reason: null } })[0]?.text).toMatch(/Contact support/);
  });
});

describe('alertsFor', () => {
  it('counts a running trial on Leads, in blue, one segment per free lead', () => {
    const [alert] = alertsFor({ plan: plan({ leadsCaptured: 1 }), usage: quiet, now: NOW, ...free });

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

  it('counts against the free leads the admin set: with 5, the 3rd lead used reads "of your 5"', () => {
    const [alert] = alertsFor({ plan: planState({ mode: 'BUSINESS', paidUntil: null, leadsCaptured: 3, now: NOW }, 5), usage: quiet, now: NOW, ...free, freeLeads: 5 });

    expect(alert).toMatchObject({ title: '3 of your 5 free leads used', text: 'After 5, the capture card stops appearing on your page until you subscribe.' });
    expect(alert?.meter).toEqual([true, true, true, false, false]);
  });

  it('takes nothing back when the allowance is lowered: spent, with a meter as long as the new allowance', () => {
    const spent = planState({ mode: 'BUSINESS', paidUntil: null, leadsCaptured: 3, now: NOW }, 2);
    const [alert] = alertsFor({ plan: spent, usage: quiet, now: NOW, ...free, freeLeads: 2 });

    expect(alert).toMatchObject({ id: 'spent', title: 'Your 2 free leads are used', meter: [true, true] });
  });

  it('counts the shop against the free orders the admin set', () => {
    const orders = { state: orderState({ mode: 'BUSINESS', paidUntil: null, ordersPlaced: 3, ordersAtTrialReset: 0, now: NOW }, 5), storeEnabled: true };
    const alert = alertsFor({ plan: plan(), usage: quiet, now: NOW, orders, ...free, freeOrders: 5 }).find((a) => a.where === '/app/orders');

    expect(alert).toMatchObject({ title: '3 of your 5 free orders used', meter: [true, true, true, false, false] });
  });

  it('comes back after a dismissal once another lead is used: the id carries the count', () => {
    const [one] = alertsFor({ plan: plan({ leadsCaptured: 1 }), usage: quiet, now: NOW, ...free });
    const [two] = alertsFor({ plan: plan({ leadsCaptured: 2 }), usage: quiet, now: NOW, ...free });
    expect(one?.id).not.toBe(two?.id);
  });

  it('says a used-up trial has stopped the capture card, in amber, and nothing else has', () => {
    const [alert] = alertsFor({ plan: plan({ leadsCaptured: FREE_LEADS }), usage: quiet, now: NOW, ...free });

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
      ...free,
    });

    expect(alert).toMatchObject({
      tone: 'stop',
      where: 'all',
      title: 'Your Business plan ended on 14 Oct 2026',
      action: { label: 'Renew your plan' },
    });
  });

  it('says both halves when a plan ended with free leads left: it ended, and capture has not stopped yet', () => {
    const [alert] = alertsFor({ plan: plan({ leadsCaptured: 1, paidUntil: new Date('2026-10-01T00:00:00.000Z') }), usage: quiet, now: NOW, ...free });

    expect(alert?.tone).toBe('stop');
    expect(alert?.title).toBe('Your Business plan ended on 1 Oct 2026');
    expect(alert?.text).toContain('You have 2 free leads left.');
  });

  it('says nothing about the plan for a paid page or a personal one', () => {
    expect(alertsFor({ plan: plan({ paidUntil: new Date('2099-01-01T00:00:00.000Z') }), usage: quiet, now: NOW, ...free })).toEqual([]);
    expect(alertsFor({ plan: plan({ mode: 'PERSONAL' }), usage: quiet, now: NOW, ...free })).toEqual([]);
  });

  it('warns near the limit, at about 80%, on Questions, in blue', () => {
    const alerts = alertsFor({ plan: plan({ mode: 'PERSONAL' }), usage: { used: 164, cap: 200 }, now: NOW, ...free });

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
    expect(alertsFor({ plan: plan({ mode: 'PERSONAL' }), usage: { used: 159, cap: 200 }, now: NOW, ...free })).toEqual([]);
  });

  it('says the limit is reached in amber, from the cap in force rather than a written-in 200', () => {
    const [alert] = alertsFor({ plan: plan({ mode: 'PERSONAL' }), usage: { used: 2000, cap: 2000 }, now: NOW, ...free });

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
      ...free,
    });
    expect(alerts.map((a) => a.where)).toEqual(['all', '/app/questions']);
  });
});

describe('alertsFor, the shop', () => {
  it('pauses an open shop whose free orders are used, in red, on Orders', () => {
    const alerts = alertsFor(page({ ordersPlaced: FREE_ORDERS }));

    expect(alerts).toContainEqual(
      expect.objectContaining({
        id: 'paused',
        tone: 'stop',
        where: '/app/orders',
        icon: 'shop',
        title: 'Your shop can’t take orders right now',
        text: 'Your 3 free orders are used. Customers can still see your shop, and their basket comes to you on WhatsApp instead.',
        action: { href: '/app/billing', label: 'Pay to take orders' },
      }),
    );
  });

  // A plan that ended always ends both allowances' paid time at once: either
  // the leads are used too (lapsed) or some are left (trial with lapsedOn).
  // Both are real pages; each gets the every-screen plan banner AND, for an
  // open shop, the orders' own paused banner, which Orders shows first.
  it.each([
    ['leads used too', FREE_LEADS],
    ['free leads left', 1],
  ])('says when the plan ended, for a shop paused by a lapsed plan (%s)', (_name, leadsCaptured) => {
    const alerts = alertsFor(page({ leadsCaptured, ordersPlaced: FREE_ORDERS, paidUntil: new Date('2026-10-13T20:00:00.000Z') }));

    expect(alerts.find((a) => a.where === 'all')).toMatchObject({ tone: 'stop', title: 'Your Business plan ended on 14 Oct 2026' });
    expect(alerts.find((a) => a.where === '/app/orders')).toMatchObject({
      id: 'paused-2026-10-13',
      tone: 'stop',
      title: 'Your shop can’t take orders right now',
      text: 'Your Business plan ended on 14 Oct 2026. Customers can still see your shop, and their basket comes to you on WhatsApp instead.',
      action: { label: 'Pay to take orders' },
    });
  });

  // The every-screen banner's shop half follows orderState, the same rule
  // checkout, the Orders banner and Billing's Orders meter read.
  const ENDED = new Date('2026-10-13T20:00:00.000Z');
  const everyScreen = (p: { ordersPlaced: number; storeEnabled?: boolean }) =>
    alertsFor(page({ leadsCaptured: FREE_LEADS, paidUntil: ENDED, ...p })).find((a) => a.where === 'all');

  it('says a lapsed plan’s shop still has its free orders, and not that it stopped, while some are left', () => {
    const alert = everyScreen({ ordersPlaced: 1 });

    expect(alert?.text).toBe(
      'The capture card is no longer shown. Your shop still has 2 free orders. After those, checkout pauses until you pay. Your page and chat still work. Pay again to switch the capture card back on.',
    );
    expect(everyScreen({ ordersPlaced: 2 })?.text).toContain('Your shop still has 1 free order. After that, checkout pauses until you pay.');
    // And Orders' own banner counts the same orders: the two cannot disagree.
    expect(alertsFor(page({ leadsCaptured: FREE_LEADS, paidUntil: ENDED, ordersPlaced: 1 })).find((a) => a.where === '/app/orders')).toMatchObject({
      title: '1 of your 3 free orders used',
    });
  });

  it('says a lapsed plan’s shop has stopped taking orders once none are left', () => {
    expect(everyScreen({ ordersPlaced: FREE_ORDERS })?.text).toBe(
      'The capture card is no longer shown and your shop has stopped taking orders. Your page and chat still work. Pay again to switch them back on.',
    );
  });

  it('says nothing about orders in a lapsed plan’s banner when the Store is off', () => {
    const text = everyScreen({ ordersPlaced: FREE_ORDERS, storeEnabled: false })?.text;
    expect(text).toBe('The capture card is no longer shown. Your page and chat still work. Pay again to switch it back on.');
  });

  it('counts the free orders on Orders, in blue, while the trial runs', () => {
    const alert = alertsFor(page({ ordersPlaced: 1 })).find((a) => a.where === '/app/orders');

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
    const aboutOrders = (input: Parameters<typeof alertsFor>[0]) => alertsFor(input).filter((a) => a.where === '/app/orders');
    expect(aboutOrders(page({ ordersPlaced: FREE_ORDERS, storeEnabled: false }))).toEqual([]);
    expect(aboutOrders(page({ ordersPlaced: 9, paidUntil: new Date('2099-01-01T00:00:00.000Z') }))).toEqual([]);
    expect(aboutOrders(page({ mode: 'PERSONAL' }))).toEqual([]);
  });
});

describe('alertsFor, a CHIP key that was refused', () => {
  const refused = (p: Parameters<typeof page>[0] = {}) => ({ ...page(p), orders: { ...shop(p), chipRefused: true } });

  it('says CHIP is disconnected, on Orders, and links to Store’s Payment tab', () => {
    expect(alertsFor(refused())).toContainEqual({
      id: 'chip-refused',
      tone: 'warn',
      where: '/app/orders',
      icon: 'shop',
      title: 'CHIP is disconnected',
      text: 'Curios can’t use your CHIP key, so customers can only pay by QR or bank transfer until you reconnect it.',
      action: { href: '/app/store?tab=payment', label: 'Reconnect in Store' },
    });
  });

  it('on a shop with no QR or bank details, says customers cannot pay at all', () => {
    const chipOnly = { ...page(), orders: { ...shop(), chipRefused: true, payByQr: false } };
    expect(alertsFor(chipOnly).find((a) => a.id === 'chip-refused')).toMatchObject({
      tone: 'warn',
      title: 'CHIP is disconnected',
      text: 'Curios can’t use your CHIP key, so customers can’t pay at all until you reconnect it or add a DuitNow QR.',
      action: { href: '/app/store?tab=payment', label: 'Reconnect in Store' },
    });
  });

  it('is not shown while the key works, or while the shop is off', () => {
    expect(alertsFor(page()).some((a) => a.id === 'chip-refused')).toBe(false);
    expect(alertsFor(refused({ storeEnabled: false })).some((a) => a.id === 'chip-refused')).toBe(false);
  });

  it('leaves the 200-conversation and free-order alerts as they were', () => {
    const ids = alertsFor(refused({ ordersPlaced: 1 })).filter((a) => a.where === '/app/orders').map((a) => a.id);
    expect(ids).toEqual(['chip-refused', 'orders-trial-1']);
  });
});

describe('billingNeedsYou', () => {
  it('dots Billing for a paused shop too, even with free leads left', () => {
    const dot = (p: Parameters<typeof page>[0]) => {
      const { plan: pagePlan, orders } = page(p);
      return billingNeedsYou(pagePlan, orders);
    };
    expect(dot({ ordersPlaced: FREE_ORDERS })).toBe(true);
    expect(dot({ ordersPlaced: FREE_ORDERS, storeEnabled: false })).toBe(false);
    expect(dot({ ordersPlaced: 1 })).toBe(false);
  });

  it('dots Billing for a used-up trial or an ended plan, and not otherwise', () => {
    expect(billingNeedsYou(plan({ leadsCaptured: FREE_LEADS }))).toBe(true);
    expect(billingNeedsYou(plan({ leadsCaptured: FREE_LEADS, paidUntil: new Date('2026-10-01T00:00:00.000Z') }))).toBe(true);
    expect(billingNeedsYou(plan({ leadsCaptured: 1, paidUntil: new Date('2026-10-01T00:00:00.000Z') }))).toBe(true);
    expect(billingNeedsYou(plan({ leadsCaptured: 1 }))).toBe(false);
    expect(billingNeedsYou(plan({ paidUntil: new Date('2099-01-01T00:00:00.000Z') }))).toBe(false);
  });
});
