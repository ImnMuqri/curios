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

  it('the email field carries Peek on sign in and sign up', () => {
    for (const ui of [<SignInForm key="in" onSubmit={async () => undefined} />, <SignUpForm key="up" onSubmit={async () => undefined} wantedHandle="" />]) {
      const { container, unmount } = render(ui);
      const email = container.querySelector('#email') as HTMLElement;
      const field = email.closest('div[class*="field"]') as HTMLElement;
      expect(field.querySelectorAll('[data-peek]')).toHaveLength(2);
      expect(container.querySelector('#password')?.closest('div[class*="field"]')?.querySelector('[data-peek]')).toBeNull();
      unmount();
    }
  });

  it('both claim fields carry Peek, and each claim input has a placeholder to detect text against', () => {
    for (const [id, variant] of [['claim-hero', 'hero'], ['claim-end', 'end']] as const) {
      const { container, unmount } = render(
        <Claim id={id} label="Address" placeholder="yourname" button="Go" variant={variant} />,
      );
      const input = container.querySelector(`#${id}`) as HTMLInputElement;
      expect(input).toHaveAttribute('placeholder', 'yourname');
      expect(input.parentElement?.querySelectorAll('[data-peek]')).toHaveLength(2);
      unmount();
    }
  });

  it('no file under app/[handle] imports Peek', () => {
    const files = tsxUnder(join(__dirname, '..', '[handle]'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/_peek|Peek/);
    }
  });
});
