import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { Peek } from './Peek.js';
import { Claim } from '../_landing/Claim.js';
import { SignInForm } from '../signin/signin-form.js';
import { SignUpForm } from '../signup/signup-form.js';

function tsxUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return tsxUnder(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('Peek', () => {
  it("Peek's two layers sit behind and in front of the field", () => {
    const { container } = render(<Peek variant="auth" width={84} right={18} top={-18.8} />);
    const body = container.querySelector('[data-peek="body"]') as HTMLElement;
    const front = container.querySelector('[data-peek="front"]') as HTMLElement;

    expect(body).toHaveAttribute('aria-hidden', 'true');
    expect(front).toHaveAttribute('aria-hidden', 'true');
    // Same box, so the hands land exactly over the body.
    expect(body.style.width).toBe('84px');
    expect(front.style.width).toBe('84px');
    expect(front.style.top).toBe(body.style.top);
    // The hands layer is the one lifted in front (a module class, z 3).
    expect(front.className).not.toBe(body.className);
    expect(front.className).toMatch(/front/);
    expect(body.className).not.toMatch(/front/);
  });

  it('two Peeks on one page have unique clip ids', () => {
    const { container } = render(
      <>
        <Peek variant="claim" width={78} right={26} top={-41.6} />
        <Peek variant="claim" width={104} right={40} top={-55.5} />
      </>,
    );
    const ids = [...container.querySelectorAll('clipPath')].map((node) => node.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) {
      expect(container.querySelector(`[clip-path="url(#${id})"]`)).not.toBeNull();
    }
  });

  it('the email pill carries Peek on sign in and sign up, and the password pill none', () => {
    for (const ui of [<SignInForm key="in" onSubmit={async () => undefined} />, <SignUpForm key="up" onSubmit={async () => undefined} wantedHandle="" />]) {
      const { container, unmount } = render(ui);
      const email = container.querySelector('#email') as HTMLElement;
      // Full body, in the pill's wrapper (the Site board's `.apk`), not the claim field's two layers.
      const wrapper = email.parentElement?.parentElement as HTMLElement;
      expect(wrapper.querySelectorAll('[data-auth-peek]')).toHaveLength(1);
      expect(wrapper.querySelector('svg[viewBox="0 0 160 150"]')).not.toBeNull();
      const password = container.querySelector('#password') as HTMLElement;
      expect(password.parentElement?.parentElement?.querySelector('[data-auth-peek]')).toBeNull();
      unmount();
    }
  });

  it('the hero claim field carries a live Peek, the closing one none, and each input has a placeholder', () => {
    for (const [id, variant, peeks] of [['claim-hero', 'hero', 1], ['claim-end', 'end', 0]] as const) {
      const { container, unmount } = render(
        <Claim id={id} label="Address" placeholder="yourname" button="Go" variant={variant} />,
      );
      const input = container.querySelector(`#${id}`) as HTMLInputElement;
      expect(input).toHaveAttribute('placeholder', 'yourname');
      expect(container.querySelectorAll('svg[viewBox="0 0 160 150"]')).toHaveLength(peeks);
      unmount();
    }
  });

  it('only the paid and failed screens import Peek under app/[handle]', () => {
    const files = tsxUnder(join(__dirname, '..', '[handle]'));
    expect(files.length).toBeGreaterThan(0);
    // A shop's page is the owner's, not ours; the one exception is the paid/failed result mark (owner, 25 Nov 2026).
    const allowed = join('shop', 'checkout', 'result-mark.tsx');
    for (const file of files) {
      if (file.endsWith(allowed)) {
        expect(readFileSync(file, 'utf8'), file).toMatch(/_peek\/LivePeek/);
        continue;
      }
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/_peek|Peek/);
    }
  });
});
