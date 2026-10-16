import { describe, expect, it } from 'vitest';
import { firstMessage, waNumber } from './first-message.js';

describe('firstMessage', () => {
  it('says back what the lead asked for, and offers to talk', () => {
    expect(firstMessage('Kek Lina', { product: 'Kek coklat, 2kg', date: 'Sat 24 Oct', location: 'Klang' }, 'en')).toBe(
      'Hi! This is Kek Lina. You asked in the chat about kek coklat, 2kg for Sat 24 Oct, in Klang. Happy to help. When suits you to talk it through?',
    );
  });

  it('asks how to help when nothing was picked out', () => {
    expect(firstMessage('Kek Lina', null, 'en')).toBe('Hi! This is Kek Lina. You asked in the chat. How can I help?');
  });

  it('writes in Malay for a Malay page', () => {
    expect(firstMessage('Kek Lina', { product: 'Kek batik', date: null, location: 'Shah Alam' }, 'ms')).toBe(
      'Hai! Ini Kek Lina. Awak ada tanya dalam chat tentang kek batik, di Shah Alam. Boleh saya bantu. Bila sesuai untuk kita bincang?',
    );
  });
});

describe('waNumber', () => {
  it('keeps only the digits wa.me takes', () => {
    expect(waNumber('+60127814402')).toBe('60127814402');
  });
});
