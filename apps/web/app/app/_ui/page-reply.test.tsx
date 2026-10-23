import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PageReply } from './page-reply.js';

const css = (file: string) => readFileSync(join(import.meta.dirname, file), 'utf8');
const block = (source: string, selector: string) =>
  new RegExp(String.raw`(?:^|\n)${selector.replace('.', String.raw`\.`)}\s*\{([^}]*)\}`).exec(source)?.[1] ?? null;

describe('PageReply', () => {
  it('is the reply as plain text under a small "{Name}’s page" label', () => {
    render(<PageReply name="Kek Lina">Kek coklat 2kg is RM170.</PageReply>);
    expect(screen.getByText('Kek Lina’s page')).toBeInTheDocument();
    expect(screen.getByText('Kek coklat 2kg is RM170.')).toBeInTheDocument();
  });

  it('says "Your page" when it has no name', () => {
    render(<PageReply>Hello</PageReply>);
    expect(screen.getByText('Your page')).toBeInTheDocument();
  });

  it('has no bubble, and takes its colours from the panel it sits on, so it reads on light and dark', () => {
    const source = css('./page-reply.module.css');
    const reply = block(source, '.reply');
    const who = block(source, '.who');
    expect(reply).not.toBeNull();
    expect(reply).not.toMatch(/background|border|padding|radius/);
    expect(reply).not.toMatch(/(^|[\s;])color:\s*(?!inherit)/);
    expect(who).toMatch(/font-size:\s*10\.5px/);
    expect(who).toMatch(/opacity:\s*0\.65/);
    expect(who).not.toMatch(/(^|[\s;])color:/);
    expect(source).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });
});

// The page's replies in the previews were bubbles (a tint, a rounded corner, ink text).
describe('the previews draw no reply bubble', () => {
  const classes: [string, string][] = [
    ['../leads/leads.module.css', '.fromPage'],
    ['../questions/questions.module.css', '.reply'],
    ['../questions/questions.module.css', '.replyNote'],
    ['../review/review.module.css', '.reply'],
    ['../knowledge/knowledge.module.css', '.a'],
    ['../curios/curios.module.css', '.pvA'],
  ];
  it.each(classes)('%s %s', (file, selector) => {
    const body = block(css(file), selector);
    if (body !== null) expect(body).not.toMatch(/background|border|padding|radius|(^|[\s;])color:/);
  });
});
