import { useState } from 'react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Spark, StatStrip, type StatCard } from './stat-strip.js';
import styles from './stat-strip.module.css';

const css = readFileSync(path.resolve(__dirname, './stat-strip.module.css'), 'utf8');

const CARDS: StatCard[] = [
  { id: 'check', label: 'Receipt to check', value: 1, go: 'Check it →', urgent: true, filter: 'check' },
  { id: 'paid', label: 'Paid, to make', value: 3, go: 'See them →', filter: 'paid' },
  { id: 'week', label: 'This week', value: 'RM480', line: '+RM235 today', spark: [0, 1, 2, 3, 4, 5, 6] },
];

function Harness({ onFilter }: { onFilter: (f: string | null) => void }) {
  const [active, setActive] = useState<string | null>(null);
  return (
    <StatStrip
      cards={CARDS}
      active={active}
      onFilter={(f) => {
        onFilter(f);
        setActive(f);
      }}
    />
  );
}

describe('StatStrip', () => {
  it('makes buttons only of the cards with a filter', () => {
    render(<StatStrip cards={CARDS} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toHaveTextContent('Receipt to check');
    expect(buttons[1]).toHaveTextContent('Paid, to make');
    expect(screen.getByText('This week').closest('button')).toBeNull();
    expect(screen.getByText('+RM235 today')).toBeInTheDocument();
  });

  it('presses a card, presses another, and a second click clears it', async () => {
    const user = userEvent.setup();
    const onFilter = vi.fn();
    render(<Harness onFilter={onFilter} />);
    const [check, paid] = screen.getAllByRole('button');
    expect(check).toHaveAttribute('aria-pressed', 'false');
    await user.click(check!);
    expect(onFilter).toHaveBeenLastCalledWith('check');
    expect(check).toHaveAttribute('aria-pressed', 'true');
    await user.click(paid!);
    expect(onFilter).toHaveBeenLastCalledWith('paid');
    expect(check).toHaveAttribute('aria-pressed', 'false');
    expect(paid).toHaveAttribute('aria-pressed', 'true');
    await user.click(paid!);
    expect(onFilter).toHaveBeenLastCalledWith(null);
    expect(paid).toHaveAttribute('aria-pressed', 'false');
  });

  it('tints the urgent card and draws a rate bar to its share', () => {
    const { container } = render(
      <StatStrip cards={[{ id: 'r', label: 'Answered', value: '80%', rate: 0.8, urgent: true }]} />,
    );
    expect(container.querySelector(`.${styles.urgent}`)).not.toBeNull();
    const fill = container.querySelector(`.${styles.bar} u`) as HTMLElement;
    expect(fill.style.width).toBe('80%');
  });

  it('keeps the board values (Dash.html 1405-1418, 1441-1443)', () => {
    expect(css).toMatch(/\.strip \{[^}]*gap: 12px;[^}]*margin-top: 24px;/);
    expect(css).toMatch(/\.card \{[^}]*min-height: 112px;[^}]*padding: 16px 18px;[^}]*border-radius: var\(--r-box\);/);
    expect(css).toMatch(/button\.card:hover \{[^}]*var\(--calm-hover-ring\),[^}]*var\(--calm-hover-shadow\)/);
    expect(css).toMatch(/\.card\[aria-pressed='true'\] \{[^}]*inset 0 0 0 2px var\(--ink\)/);
    expect(css).toMatch(/button\.card:active \{[^}]*scale\(0\.99\)/);
    expect(css).toMatch(/\.urgent \{[^}]*var\(--calm-urgent\);[^}]*var\(--calm-urgent-ring\)/);
    expect(css).toMatch(
      /@media \(max-width: 760px\) \{\s*\.strip \{[^}]*display: flex;[^}]*overflow-x: auto;[^}]*scroll-snap-type: x mandatory;/,
    );
    expect(css).toMatch(/\.card \{\s*flex: 0 0 72%;\s*min-height: 104px;/);
  });
});

describe('Spark', () => {
  it('draws seven bars 12px apart, bottom-aligned, scaled to the week, today marked', () => {
    const { container } = render(<Spark values={[0, 13, 26, 5, 1, 0, 52]} />);
    const svg = container.querySelector('svg')!;
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('viewBox', '0 0 84 28');
    const rects = [...svg.querySelectorAll('rect')];
    expect(rects.map((r) => r.getAttribute('x'))).toEqual(['0', '12', '24', '36', '48', '60', '72']);
    expect(rects.every((r) => r.getAttribute('width') === '8' && r.getAttribute('rx') === '2')).toBe(true);
    // max(4, round(26 * v / 52))
    expect(rects.map((r) => Number(r.getAttribute('height')))).toEqual([4, 7, 13, 4, 4, 4, 26]);
    expect(rects.map((r) => Number(r.getAttribute('y')) + Number(r.getAttribute('height')))).toEqual(Array(7).fill(28));
    expect(rects.filter((r) => r.getAttribute('class') === styles.today)).toEqual([rects[6]]);
  });

  it('draws a quiet week as seven floor-height bars', () => {
    const { container } = render(<Spark values={[0, 0, 0, 0, 0, 0, 0]} />);
    expect([...container.querySelectorAll('rect')].map((r) => r.getAttribute('height'))).toEqual(Array(7).fill('4'));
  });

  it('sits top-right, in the spark tokens, and hides on a phone', () => {
    expect(css).toMatch(/\.spark \{[^}]*top: 18px;[^}]*right: 18px;/);
    expect(css).toMatch(/\.spark rect \{\s*fill: var\(--calm-spark\);/);
    expect(css).toMatch(/\.spark \.today \{\s*fill: var\(--calm-spark-today\);/);
    expect(css).toMatch(/@media \(max-width: 760px\) \{[\s\S]*\.spark \{\s*display: none;/);
  });
});
