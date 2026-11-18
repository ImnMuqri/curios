import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { cssZoom } from '../lib/css-zoom.js';

/*
 * Laptops see Curios's own screens at 90% (globals.css, DEVIATIONS 345). These hold the parts a
 * look at one screen would not catch: the band, which roots opt in, and that every rule filling
 * the window divides by the zoom, since 100vh on a zoomed page draws 90% of the window.
 */

const read = (relative: string) => readFileSync(path.resolve(__dirname, relative), 'utf8');
const noComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });

describe('the laptop scale', () => {
  const globals = noComments(read('./globals.css'));

  it('zooms to 90% only between the tablet breakpoint and a 1920px desktop, with a fine pointer', () => {
    const block = globals.match(
      /@supports \(zoom: 0\.9\) \{\s*@media \(min-width: 1101px\) and \(max-width: 1919px\) and \(hover: hover\) and \(pointer: fine\) \{\s*html:has\(\[data-laptop-scale\]\) \{([^}]*)\}/,
    );
    expect(block, 'the zoom rule and its bounds').not.toBeNull();
    const body = block![1]!;
    expect(body).toMatch(/--page-zoom:\s*0\.9;/);
    expect(body).toMatch(/(?<!-)zoom:\s*0\.9;/);
    // Nothing else in the file zooms or sets the factor, so the two cannot drift apart.
    expect(globals.match(/--page-zoom:/g)).toHaveLength(1);
    expect(globals.match(/(?<![-\w(])zoom:/g)).toHaveLength(1);
  });

  it('starts one pixel above the breakpoint where the dashboard turns into its phone layout', () => {
    // A phone or tablet layout is never zoomed: the frame's breakpoint and the band's floor meet.
    expect(read('./app/app-frame.module.css')).toContain('@media (max-width: 1100px)');
  });

  it("opts in Curios's own screens, and not an owner's public page", () => {
    const roots: [string, RegExp][] = [
      ['./_landing/LandingPage.tsx', /<div className=\{calm\.page\}[^>]*\bdata-laptop-scale\b/],
      ['./_legal/LegalPage.tsx', /<div className=\{styles\.legal\}[^>]*\bdata-laptop-scale\b/],
      ['./_auth/AuthShell.tsx', /<div className=\{styles\.auth\}[^>]*\bdata-laptop-scale\b/],
      ['./_system/SystemShell.tsx', /<div className=\{styles\.sy\}[^>]*\bdata-laptop-scale\b/],
      ['./app/app-frame.tsx', /<div ref=\{frameRef\} className=\{styles\.frame\}[^>]*\bdata-laptop-scale\b/],
    ];
    for (const [file, root] of roots) expect(read(file), file).toMatch(root);

    const customer = walk(path.resolve(__dirname, '[handle]')).filter((f) => /\.tsx$/.test(f) && !/\.test\.tsx$/.test(f));
    expect(customer.length).toBeGreaterThan(0);
    for (const file of customer) expect(readFileSync(file, 'utf8'), file).not.toContain('data-laptop-scale');
  });

  it('divides every full-window length on the zoomed screens by --page-zoom', () => {
    const sheets = [
      ...walk(path.resolve(__dirname, 'app')),
      ...walk(path.resolve(__dirname, '_auth')),
      ...walk(path.resolve(__dirname, '_system')),
      ...walk(path.resolve(__dirname, '_landing')),
      ...walk(path.resolve(__dirname, '_legal')),
      path.resolve(__dirname, 'auth.module.css'),
    ].filter((f) => f.endsWith('.css'));
    expect(sheets.length).toBeGreaterThan(20);

    const bare: string[] = [];
    let compensated = 0;
    for (const file of sheets) {
      const css = noComments(readFileSync(file, 'utf8'));
      for (const m of css.matchAll(/\b100[dsl]?v[hw]\b(.{0,24})/g)) {
        if (m[1]!.startsWith(' / var(--page-zoom, 1)')) compensated++;
        else bare.push(`${path.relative(__dirname, file)}: ${m[0]}`);
      }
    }
    expect(bare).toEqual([]);
    // The frame, the sidebar, the auth shells, the system and legal pages, the landing: all of them.
    expect(compensated).toBeGreaterThanOrEqual(20);
  });

  it('the frame, the sidebar and the auth panels fill the window under the zoom', () => {
    const frame = noComments(read('./app/app-frame.module.css'));
    const side = frame.slice(frame.indexOf('\n.side {'), frame.indexOf('\n}', frame.indexOf('\n.side {')));
    expect(side).toContain('height: calc(100vh / var(--page-zoom, 1));');
    expect(noComments(read('./auth.module.css'))).toContain('height: calc(100dvh / var(--page-zoom, 1));');
    expect(noComments(read('./_auth/scene.module.css'))).toContain('height: calc(100dvh / var(--page-zoom, 1) - 28px);');
  });

  it('turns measured boxes back into CSS pixels where a measurement becomes a length', () => {
    for (const file of ['./_landing/Hero.tsx', './_landing/Closing.tsx', './_landing/Lands.tsx', './app/store/photo-cropper.tsx']) {
      expect(read(file), file).toMatch(/cssZoom\(/);
    }
  });
});

describe('cssZoom', () => {
  it('reads currentCSSZoom where the browser has it', () => {
    const el = document.createElement('div');
    Object.defineProperty(el, 'currentCSSZoom', { value: 0.9 });
    expect(cssZoom(el)).toBe(0.9);
  });

  it('is 1 without it, for no element, and for a nonsense value', () => {
    expect(cssZoom(document.createElement('div'))).toBe(1);
    expect(cssZoom(null)).toBe(1);
    const el = document.createElement('div');
    Object.defineProperty(el, 'currentCSSZoom', { value: 0 });
    expect(cssZoom(el)).toBe(1);
  });
});
