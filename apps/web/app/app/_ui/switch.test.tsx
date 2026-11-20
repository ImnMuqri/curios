import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Switch } from './switch.js';

function Harness() {
  const [on, setOn] = useState(false);
  return <Switch checked={on} onChange={setOn} label="Take orders" />;
}

describe('Switch', () => {
  it('toggles on click, Space and Enter, and says so in aria-checked', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const sw = screen.getByRole('switch', { name: 'Take orders' });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    await user.click(sw);
    expect(sw).toHaveAttribute('aria-checked', 'true');
    sw.focus();
    await user.keyboard(' ');
    expect(sw).toHaveAttribute('aria-checked', 'false');
    await user.keyboard('{Enter}');
    expect(sw).toHaveAttribute('aria-checked', 'true');
  });

  it('does not toggle when disabled', async () => {
    const user = userEvent.setup();
    let calls = 0;
    render(<Switch checked={false} onChange={() => calls++} label="x" disabled />);
    await user.click(screen.getByRole('switch'));
    expect(calls).toBe(0);
  });

  it('has a 44px hit area and the calm off track', () => {
    const css = readFileSync(path.resolve(__dirname, './switch.module.css'), 'utf8');
    expect(css).toMatch(/\.hit \{[^}]*width: 44px;[^}]*height: 44px;/);
    expect(css).toMatch(/\.track \{[^}]*background: var\(--calm-switch-off\)/);
    expect(readFileSync(path.resolve(__dirname, './editor.module.css'), 'utf8')).toMatch(
      /\.switch \{[^}]*background: var\(--calm-switch-off\)/,
    );
  });
});
