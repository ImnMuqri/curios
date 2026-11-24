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

  it('is a status a screen reader says while it waits, and nothing of the kind once it replies', () => {
    const { unmount } = render(<PageReply name="Kek Lina" label="Thinking">…</PageReply>);
    expect(screen.getByRole('status', { name: 'Thinking' })).toBeInTheDocument();
    unmount();
    render(<PageReply name="Kek Lina">Kek coklat 2kg is RM170.</PageReply>);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('says "Your page" when it has no name', () => {
    render(<PageReply>Hello</PageReply>);
    expect(screen.getByText('Your page')).toBeInTheDocument();
  });

  it('has no bubble, and its words take the colour of the panel they sit on', () => {
    const source = css('./page-reply.module.css');
    const reply = block(source, '.reply');
    expect(reply).not.toBeNull();
    expect(reply).not.toMatch(/background|border|padding|radius/);
    expect(reply).not.toMatch(/(^|[\s;])color:\s*(?!inherit)/);
    expect(source).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it('sits beside Peek’s eyes in the dashboard, and beside the page’s accent dot on the owner’s page', () => {
    const { container, unmount } = render(<PageReply name="Kek Lina">Hi</PageReply>);
    expect(container.querySelector('svg')).not.toBeNull();
    expect(container.firstElementChild).not.toHaveAttribute('data-on-page');
    unmount();
    const onPage = render(<PageReply name="Kek Lina" onPage>Hi</PageReply>);
    expect(onPage.container.querySelector('svg')).toBeNull();
    expect(onPage.container.firstElementChild).toHaveAttribute('data-on-page', 'true');
    const source = css('./page-reply.module.css');
    expect(block(source, '.dot')).toMatch(/background:\s*var\(--accent/);
    // On the owner's page the label's words dim to 65%; the dot beside them does not.
    expect(source).toMatch(/\.reply\[data-on-page\] \.whoName\s*\{\s*opacity:\s*0\.65/);
  });
});

// The page's replies in the previews were bubbles (a tint, a rounded corner). Their text colour
// is the dashboard's own now that the chats are neutral (Dashboard v2), so only the bubble is ruled out.
// Leads left this list with the calm board (19 Nov 2026): its conversation sheet draws the page's
// replies as the board's white card bubbles (Dash.html .xconvsh .xa).
describe('the previews draw no reply bubble', () => {
  const classes: [string, string][] = [
    ['../questions/questions.module.css', '.reply'],
    ['../questions/questions.module.css', '.replyNote'],
    ['../review/review.module.css', '.reply'],
    ['../knowledge/knowledge.module.css', '.a'],
    ['../curios/curios.module.css', '.pvA'],
  ];
  it.each(classes)('%s %s', (file, selector) => {
    const body = block(css(file), selector);
    if (body !== null) expect(body).not.toMatch(/background|border|padding|radius/);
  });
});

describe('PageReply, the picture', () => {
  it('draws it in the dot on the owner page, with no alt', () => {
    const { container } = render(<PageReply name="Kek Lina" onPage avatarUrl="/a.webp">Hi</PageReply>);
    const img = container.querySelector('img');
    expect(img).toHaveAttribute('src', '/a.webp');
    expect(img).toHaveAttribute('alt', '');
  });

  it('is the plain dot with no picture', () => {
    const { container } = render(<PageReply name="Kek Lina" onPage>Hi</PageReply>);
    expect(container.querySelector('img')).toBeNull();
  });
});
