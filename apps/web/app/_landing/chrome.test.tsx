import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import { LandingPage } from './LandingPage.js';
import { COPY, landingCopy } from './copy.js';
import { Nav } from './Nav.js';
import { LOCALES, TERMS, read } from './test-kit.js';

const MODULES = ['calm.module.css', 'nav.module.css', 'footer.module.css'];

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(window, 'scrollY', { value: 0, configurable: true, writable: true });
});

describe('the nav', () => {
  it('sticks the nav and frosts it only once the page has scrolled', () => {
    render(<Nav nav={landingCopy('en', TERMS).nav} home="/" />);
    const header = screen.getByRole('banner');
    expect(header).not.toHaveAttribute('data-stuck');
    Object.defineProperty(window, 'scrollY', { value: 40, configurable: true, writable: true });
    act(() => {
      window.dispatchEvent(new Event('scroll'));
    });
    expect(header).toHaveAttribute('data-stuck');
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true, writable: true });
    act(() => {
      window.dispatchEvent(new Event('scroll'));
    });
    expect(header).not.toHaveAttribute('data-stuck');
  });

  it('frosts .nav[data-stuck] and nothing else', () => {
    const frosted = MODULES.flatMap((f) =>
      [...read(f).replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{[^{}]*backdrop-filter/g)].map((m) => m[1]!.trim()),
    );
    expect(frosted).toEqual(['.nav[data-stuck]']);
  });

  it.each(LOCALES)('%s: links the five sections, the other language, sign in and sign up', (locale) => {
    render(<LandingPage locale={locale} terms={TERMS} />);
    const { nav } = COPY[locale];
    const header = screen.getByRole('banner');
    for (const [id, name] of [
      ['who', nav.who],
      ['how', nav.how],
      ['business', nav.business],
      ['pricing', nav.pricing],
      ['faq', nav.faq],
    ])
      expect(within(header).getByRole('link', { name })).toHaveAttribute('href', `#${id}`);
    expect(within(header).getByRole('link', { name: nav.other.name })).toHaveAttribute('href', nav.other.href);
    expect(within(header).getByRole('link', { name: nav.other.name })).toHaveTextContent(nav.other.short);
    expect(within(header).getByRole('link', { name: nav.signIn })).toHaveAttribute('href', '/signin');
    expect(within(header).getByRole('link', { name: nav.cta })).toHaveAttribute('href', '/signup');
  });
});

describe('the footer', () => {
  it.each(LOCALES)('%s: the footer has the wordmark, the sections, sign in, the other language by name, and the note', (locale) => {
    render(<LandingPage locale={locale} terms={TERMS} />);
    const { nav, footer } = COPY[locale];
    const foot = screen.getByRole('contentinfo');
    expect(within(foot).getByRole('img', { name: 'curios' })).toBeInTheDocument();
    for (const name of [nav.who, nav.how, nav.business, nav.pricing, nav.faq]) expect(within(foot).getByRole('link', { name })).toBeInTheDocument();
    expect(within(foot).getByRole('link', { name: footer.signIn })).toHaveAttribute('href', '/signin');
    expect(within(foot).getByRole('link', { name: nav.other.name })).toHaveTextContent(nav.other.name);
    expect(foot).toHaveTextContent(footer.note);
  });

  it('says the samples are made up, and nothing about where the photos come from', () => {
    expect(COPY.en.footer.note).toBe('Every person, shop and order on this page is a made-up sample.');
    expect(COPY.en.footer.note).not.toMatch(/Unsplash/);
  });

  it('keeps the Terms, Privacy, Refund and Return links and the operator line', () => {
    const { unmount } = render(<LandingPage locale="en" terms={TERMS} />);
    let foot = screen.getByRole('contentinfo');
    expect(within(foot).getByRole('link', { name: 'Terms' })).toHaveAttribute('href', '/terms');
    expect(within(foot).getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/privacy');
    expect(within(foot).getByRole('link', { name: 'Refunds' })).toHaveAttribute('href', '/refunds');
    expect(within(foot).getByRole('link', { name: 'Returns' })).toHaveAttribute('href', '/returns');
    expect(foot).toHaveTextContent('BSYX LABS');
    expect(foot).toHaveTextContent('202603086039 (TR0339989-A)');
    expect(within(foot).getByRole('link', { name: 'support@curios.my' })).toHaveAttribute('href', 'mailto:support@curios.my');
    unmount();
    render(<LandingPage locale="ms" terms={TERMS} />);
    foot = screen.getByRole('contentinfo');
    expect(within(foot).getByRole('link', { name: 'Terma' })).toHaveAttribute('href', '/ms/terms');
    expect(within(foot).getByRole('link', { name: 'Pemulangan' })).toHaveAttribute('href', '/ms/returns');
  });
});
