import { screen } from '@testing-library/react';
import type userEvent from '@testing-library/user-event';
import { shopCopy } from '../copy.js';

/**
 * Paying by the owner's QR now means attaching the receipt before the order can be sent: a small JPEG
 * (its first bytes are what the API checks; the picker only checks the type and size).
 */
export async function attachReceipt(user: ReturnType<typeof userEvent.setup>, name = 'receipt.jpg', language = 'en') {
  const copy = shopCopy(language);
  const file = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4])], name, { type: 'image/jpeg' });
  // The first box is "Attach your receipt"; once one is held the quiet "Upload a different receipt" label is the input.
  const box = screen.queryByLabelText(new RegExp(copy.attachReceipt)) ?? screen.queryByLabelText(copy.uploadDifferent);
  // No box: the order is free or paid another way, so there is nothing to attach.
  if (box) await user.upload(box, file);
}
