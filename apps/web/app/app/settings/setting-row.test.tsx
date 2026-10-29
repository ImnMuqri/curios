import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { KeyIcon, SettingRow } from './setting-row.js';

describe('SettingRow', () => {
  it('is text only by default: what it is, the line under it, and what it is set to', () => {
    const { container } = render(<SettingRow title="Address" note="curios.my/keklina" action={<button type="button">Copy</button>} />);

    expect(screen.getByText('Address')).toBeInTheDocument();
    expect(screen.getByText('curios.my/keklina')).toBeInTheDocument();
    // No icon square before the title unless the row asks for one.
    expect(container.querySelector('svg')).toBeNull();
    expect(container.querySelector('[data-tone]')).toBeNull();
  });

  it('draws an icon, untinted, only where the board does (the ways to sign in)', () => {
    const { container } = render(<SettingRow title="Password" icon={<KeyIcon />} note="Not set." />);

    expect(container.querySelector('svg')).not.toBeNull();
    // A neutral square, not one tinted per row.
    expect(container.querySelector('[data-tone]')).toBeNull();
  });
});
