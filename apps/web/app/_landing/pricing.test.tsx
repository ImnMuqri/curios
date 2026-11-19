import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { defaultSettings } from '@curios/core/settings';
import { raisedSettings } from '@curios/core/test-settings';
import { LandingPage } from './LandingPage.js';
import { Pricing, payback } from './Pricing.js';
import { landingCopy } from './copy.js';
import { structuredData } from './structured-data.js';
import { LOCALES, TERMS } from './test-kit.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const en = landingCopy('en', TERMS);

describe('pricing', () => {
  it('switches Business between monthly and yearly, and says which is on', async () => {
    render(<Pricing locale="en" terms={TERMS} />);
    const pricing = document.querySelector('#pricing') as HTMLElement;
    expect(within(pricing).getByText('RM49 a month')).toBeInTheDocument();
    await userEvent.click(within(pricing).getByRole('button', { name: /Yearly/ }));
    expect(within(pricing).getByRole('button', { name: /Yearly/ })).toHaveAttribute('aria-pressed', 'true');
    expect(within(pricing).getByText('RM490 a year')).toBeInTheDocument();
    expect(pricing).toHaveTextContent('Two months free. That’s RM40.83 a month.');
  });

  it('works out the calculator from the real monthly price', () => {
    expect(en.pricing.monthlyRinggit).toBe(TERMS.prices.MONTHLY / 100);
    expect(payback(5, 95, 49)).toMatchObject({ revenue: 475, pays: true, percent: 10, times: 9 });
    expect(payback(1, 40, 49).pays).toBe(false);
    const range = render(<Pricing locale="en" terms={TERMS} />).container.querySelector('input[type="range"]')!;
    expect(range).toHaveAttribute('min', '1');
    expect(range).toHaveAttribute('max', '60');
    expect(range).toHaveValue('5');
  });

  it.each(LOCALES)('%s: the title breaks after the first sentence and carries the price in force', (locale) => {
    const raised = landingCopy(locale, raisedSettings()).pricing;
    expect(raised.title[1]).toMatch(/^RM59 /);
    const { container } = render(<Pricing locale={locale} terms={raisedSettings()} />);
    const h2 = container.querySelector('h2')!;
    expect(h2.querySelector('br')).not.toBeNull();
    expect(h2).toHaveTextContent(`${raised.title[0]}${raised.title[1]}`);
    expect(landingCopy('en', TERMS).pricing.title).toEqual(['Free for you,', 'RM49 a month for business']);
  });

  it('says N months free and the price a month, when yearly is on', () => {
    expect(en.pricing.business.noteYearly).toBe('Two months free. That’s RM40.83 a month.');
    expect(landingCopy('ms', TERMS).pricing.business.noteYearly).toBe('Percuma dua bulan. Itu RM40.83 sebulan.');
    const none = landingCopy('en', { ...TERMS, prices: { MONTHLY: 5900, ANNUAL: 70800 } }).pricing;
    expect(none.business.noteYearly).toBe('RM59 a month, paid once a year.');
  });

  it('never prints RM49, −2 months or 3 free leads at other prices', () => {
    const banned = /RM49\b|−2 months|Two months free|3 free leads|−2 bulan/;
    // raisedSettings() keeps three free leads by default; here the admin also changed them.
    for (const terms of [raisedSettings({ freeLeads: 5 }), { ...TERMS, prices: { MONTHLY: 5900, ANNUAL: 70800 }, freeLeads: 1 }]) {
      for (const locale of LOCALES) {
        const { container, unmount } = render(<Pricing locale={locale} terms={terms} />);
        expect(container.textContent).not.toMatch(banned);
        fireEvent.click(within(container).getByRole('button', { name: new RegExp(landingCopy(locale, terms).pricing.yearly) }));
        expect(container.textContent).not.toMatch(banned);
        unmount();
      }
    }
  });

  it('says one more order pays for it only when one more order does', () => {
    const { container } = render(<Pricing locale="en" terms={TERMS} />);
    const range = container.querySelector('input[type="range"]')!;
    const note = () => container.querySelector('[aria-live="polite"] p:last-child')!.textContent;
    fireEvent.change(range, { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'RM50' }));
    // One RM50 order: RM50 against RM49, it pays for itself.
    expect(note()).toBe('Business costs about 98% of that. It pays for itself.');
    // At RM150 a month, one more RM50 order still falls short.
    const { container: raised } = render(<Pricing locale="en" terms={{ ...TERMS, prices: { MONTHLY: 15000, ANNUAL: 150000 } }} />);
    fireEvent.change(raised.querySelector('input[type="range"]')!, { target: { value: '1' } });
    fireEvent.click(within(raised).getByRole('button', { name: 'RM50' }));
    expect(raised.querySelector('[aria-live="polite"] p:last-child')!.textContent).toBe(en.pricing.calc.under(false));
    expect(en.pricing.calc.under(true)).toBe('One more order and it pays for itself.');
    // At RM95 a month, one RM50 order plus one more covers it.
    const { container: near } = render(<Pricing locale="en" terms={{ ...TERMS, prices: { MONTHLY: 9500, ANNUAL: 95000 } }} />);
    fireEvent.change(near.querySelector('input[type="range"]')!, { target: { value: '1' } });
    fireEvent.click(within(near).getByRole('button', { name: 'RM50' }));
    expect(near.querySelector('[aria-live="polite"] p:last-child')!.textContent).toBe('One more order and it pays for itself.');
  });

  it('says "times over" only when it pays for itself at least twice, in both languages', () => {
    const ms = landingCopy('ms', TERMS);
    for (const times of [1, 1.5, 1.99]) {
      expect(en.pricing.calc.pays(60, times)).toBe('Business costs about 60% of that. It pays for itself.');
      expect(ms.pricing.calc.pays(60, times)).toBe('Bisnes kosnya kira-kira 60% daripada itu. Ia bayar balik sendiri.');
    }
    expect(en.pricing.calc.pays(50, 2)).toBe('Business costs about 50% of that. It pays for itself 2 times over.');
    expect(ms.pricing.calc.pays(50, 2)).toBe('Bisnes kosnya kira-kira 50% daripada itu. Ia bayar balik 2 kali ganda.');
    expect(en.pricing.calc.pays(30, 3.4)).toBe('Business costs about 30% of that. It pays for itself 3 times over.');
  });

  it('leaves no timer behind when it goes mid-swap', () => {
    vi.useFakeTimers();
    const { container, unmount } = render(<Pricing locale="en" terms={TERMS} />);
    fireEvent.click(within(container).getByRole('button', { name: /Yearly/ }));
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('Peek is happy while the Business card is hovered', () => {
    const { container } = render(<Pricing locale="en" terms={TERMS} />);
    const card = container.querySelector('[data-plan="business"]')!;
    const svg = () => card.querySelector('svg[viewBox="0 0 160 150"]')!.getAttribute('class') ?? '';
    expect(svg()).not.toMatch(/happy/);
    fireEvent.mouseEnter(card);
    expect(svg()).toMatch(/happy/);
    fireEvent.mouseLeave(card);
    expect(svg()).not.toMatch(/happy/);
  });
});

describe('pricing, at the prices the admin set', () => {
  const RAISED = raisedSettings({ freeLeads: 5 });

  it('shows the price in force, in both languages, and the calculator counts it', () => {
    render(<LandingPage locale="en" terms={RAISED} />);
    const pricing = document.querySelector('#pricing') as HTMLElement;
    expect(within(pricing).getByText('RM59 a month')).toBeInTheDocument();
    expect(within(pricing).getByRole('heading', { level: 2 })).toHaveTextContent('Free for you,RM59 a month for business');
    expect(landingCopy('ms', RAISED).pricing.title).toEqual(['Percuma untuk anda,', 'RM59 sebulan untuk bisnes']);
    expect(landingCopy('en', RAISED).pricing.monthlyRinggit).toBe(59);
  });

  it('prints a price with sen to two places, never RM49.5', () => {
    const SEN = { ...defaultSettings(), prices: { MONTHLY: 4950, ANNUAL: 49050 } };
    const p = landingCopy('en', SEN).pricing;
    expect(p.title[1]).toBe('RM49.50 a month for business');
    expect(p.business.monthly).toBe('RM49.50');
    expect(p.business.yearly).toBe('RM490.50');
    expect(p.business.noteYearly).toBe('RM40.88 a month, paid once a year.');
  });

  it('counts the free leads in force', () => {
    expect(landingCopy('en', RAISED).pricing.business.points).toContain('Your first five leads are free');
    expect(landingCopy('en', RAISED).pricing.business.cta).toBe('Start with 5 free leads');
    expect(landingCopy('ms', RAISED).pricing.business.points).toContain('Lima lead pertama percuma');
    expect(landingCopy('ms', RAISED).pricing.business.cta).toBe('Mula dengan 5 lead percuma');
    expect(landingCopy('en', { ...RAISED, freeLeads: 1 }).pricing.business.points).toContain('Your first lead is free');
  });

  it('claims months free only when the prices give them', () => {
    const raised = landingCopy('en', RAISED).pricing;
    expect(raised.business.noteMonthly).toBe('Or RM490 a year.');
    expect(raised.twoMonths).toBe('');
    const tenTimes = landingCopy('en', { ...RAISED, prices: { MONTHLY: 5900, ANNUAL: 59000 } }).pricing;
    expect(tenTimes.business.noteMonthly).toBe('Or RM590 a year: two months free.');
    expect(tenTimes.twoMonths).toBe('−2 months');
  });

  it('says one RM95 order pays for Business only while it does: at RM95 a month, not at RM96', () => {
    const at = (MONTHLY: number) => ({ ...RAISED, prices: { ...RAISED.prices, MONTHLY } });
    expect(landingCopy('en', at(9500)).pricing.business.tag).toBe('One RM95 order pays for it');
    expect(landingCopy('ms', at(9500)).pricing.business.tag).toBe('Satu tempahan RM95 dah cukup bayar');
    expect(landingCopy('en', at(9600)).pricing.business.tag).toBe('');
    render(<Pricing locale="en" terms={at(9600)} />);
    expect(document.querySelector('#pricing')).not.toHaveTextContent('One RM95 order pays for it');
  });

  it('puts the prices in force in the structured data', () => {
    const offers = structuredData(landingCopy('en', RAISED), 'https://curios.my', RAISED.prices)['@graph'].flatMap((node) => ('offers' in node ? node.offers : []));
    expect(offers.map((o) => o?.price)).toEqual(['0', '59', '490']);
  });
});
