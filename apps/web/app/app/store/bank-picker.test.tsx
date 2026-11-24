import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { BankPicker } from './bank-picker.js';

/** Puts the picker's box at `top`..`bottom` on a screen `height` tall. */
function placeAt(top: number, bottom: number, height = 800) {
  vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(height);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ top, bottom, left: 0, right: 400, width: 400, height: bottom - top, x: 0, y: top, toJSON: () => ({}) } as DOMRect);
}

afterEach(() => vi.restoreAllMocks());

describe('the bank list', () => {
  it('opens below the field when there is room', () => {
    placeAt(100, 150);
    render(<BankPicker value="" onChange={() => undefined} maxLength={60} />);
    fireEvent.focus(screen.getByRole('combobox', { name: 'Bank name' }));
    const list = screen.getByRole('listbox', { name: 'Banks' });
    expect(list).not.toHaveAttribute('data-up');
    expect(list.style.maxHeight).toBe('288px');
  });

  it('opens above the field near the bottom of the screen, no taller than the room it has, instead of stretching the page', () => {
    placeAt(640, 690);
    render(<BankPicker value="" onChange={() => undefined} maxLength={60} />);
    fireEvent.focus(screen.getByRole('combobox', { name: 'Bank name' }));
    const list = screen.getByRole('listbox', { name: 'Banks' });
    expect(list).toHaveAttribute('data-up');
    expect(parseInt(list.style.maxHeight, 10)).toBeLessThanOrEqual(288);
    expect(parseInt(list.style.maxHeight, 10)).toBeGreaterThanOrEqual(140);
  });
});
