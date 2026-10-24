import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { shopCopy } from '../../shop/copy.js';
import { PayBox } from './pay-box.js';

const copy = shopCopy('en');
const bank = { name: 'Maybank', accountName: 'Lina', accountNumber: '1234567890' };
const writeText = vi.fn(async () => undefined);

afterEach(() => writeText.mockClear());

function show(preview: boolean) {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  return render(<PayBox name="Kek Lina" qrUrl="https://files.example/qr.png" bank={bank} copy={copy} saveHref={preview ? undefined : '/keklina/order/tok/qr'} preview={preview} />);
}

describe('PayBox', () => {
  it('on the real page, saves the QR from a download link and copies the account number', () => {
    const { container } = show(false);
    expect(container.querySelector('a[download][href$="/qr"]')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: copy.copy }));
    expect(writeText).toHaveBeenCalledWith('1234567890');
  });

  it('in the Store preview, draws Save QR as a picture and copies nothing', () => {
    const { container } = show(true);
    expect(container.querySelector('a')).toBeNull();
    expect(container.querySelector('[download]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: copy.copy }));
    expect(writeText).not.toHaveBeenCalled();
  });
});
