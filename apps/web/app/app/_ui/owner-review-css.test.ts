import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (file: string) => readFileSync(path.resolve(__dirname, '..', file), 'utf8').replace(/\r\n/g, '\n');
const body = (css: string, selector: string) => {
  const at = css.indexOf(`${selector} {`);
  return at < 0 ? '' : css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
};
const phone = (css: string) => {
  const at = css.indexOf('@media (max-width: 760px) {');
  return at < 0 ? '' : css.slice(at);
};

describe('owner review fixes (24 Nov 2026), as CSS', () => {
  it('centres Peek over the Help panel heading', () => {
    const help = read('help/help.module.css');
    expect(body(help, '.empty')).toMatch(/align-items:\s*center/);
    expect(body(help, '.panel .peek')).toMatch(/margin:\s*0 auto/);
  });

  it('gives the sidebar list a thin rounded scrollbar that shows on hover, in tokens', () => {
    const css = read('app-frame.module.css');
    expect(body(css, '.nav')).toMatch(/scrollbar-width:\s*thin/);
    expect(body(css, '.nav:hover')).toMatch(/scrollbar-color:\s*var\(--edge\) transparent/);
    expect(body(css, '.nav::-webkit-scrollbar')).toMatch(/width:\s*6px/);
    expect(body(css, '.nav::-webkit-scrollbar-thumb')).toMatch(/border-radius/);
    expect(body(css, '.nav:hover::-webkit-scrollbar-thumb')).toMatch(/background:\s*var\(--edge\)/);
  });

  it('draws a tab count as part of the pill: no box, the pill colour at reduced opacity', () => {
    const pills = read('_ui/pill-tabs.module.css');
    const count = body(pills, '.count');
    expect(count).toMatch(/background:\s*none/);
    expect(count).toMatch(/opacity:\s*0\.7/);
    expect(count).not.toMatch(/color:/);
    expect(read('knowledge/knowledge.module.css')).not.toContain('.tabCount');
  });

  it('keeps the page head flush on desktop and gives it a gap under the phone top bar', () => {
    const head = read('_ui/page-head.module.css');
    expect(body(head, '.head')).toMatch(/padding:\s*0 var\(--head-x\) 20px/);
    expect(body(phone(head), '.head')).toMatch(/padding:\s*18px var\(--head-x\) 14px/);
  });

  it('puts the loading bar directly under the phone top bar', () => {
    const bar = read('_ui/nav-progress.module.css');
    expect(body(bar, '.bar')).toMatch(/bottom:\s*8px/);
    const onPhone = body(phone(bar), '.bar');
    // Fixed under the 56px sticky top bar (z-index 30), above it in the stack but never over it.
    expect(onPhone).toMatch(/position:\s*fixed/);
    expect(onPhone).toMatch(/top:\s*56px/);
    expect(onPhone).toMatch(/z-index:\s*3[1-9]/);
    expect(onPhone).toMatch(/left:\s*0;[^}]*right:\s*0/);
  });

  it('draws the chosen inbox row deeper than the hover wash', () => {
    const inbox = read('_ui/inbox.module.css');
    expect(body(inbox, ".li[aria-current='true']")).toMatch(/var\(--pick-weight, 80%\)/);
  });

  it('draws the bell attention rows in the board pink, by tokens', () => {
    const rows = read('_ui/notifications.module.css');
    expect(body(rows, '.alert')).toMatch(/background:\s*var\(--calm-urgent\)/);
    expect(body(rows, 'a.alert:hover')).toMatch(/background:\s*var\(--tag-attn\)/);
  });

  it('spans Review empty state across the column in the dashed box', () => {
    const css = read('review/review.module.css');
    expect(body(css, '.esCard')).not.toMatch(/max-width/);
    expect(body(css, '.es')).toMatch(/border:\s*1\.5px dashed var\(--edge\)/);
  });
});
