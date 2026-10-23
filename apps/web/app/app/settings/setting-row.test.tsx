import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SettingRow } from './setting-row.js';

describe('SettingRow', () => {
  it('is text only: what it is, the line under it, and what it is set to', () => {
    const { container } = render(<SettingRow title="Address" note="curios.my/keklina" action={<button type="button">Copy</button>} />);

    expect(screen.getByText('Address')).toBeInTheDocument();
    expect(screen.getByText('curios.my/keklina')).toBeInTheDocument();
    // No tinted icon square before the title.
    expect(container.querySelector('svg')).toBeNull();
    expect(container.querySelector('[data-tone]')).toBeNull();
  });
});
