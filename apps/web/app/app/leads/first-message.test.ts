import { describe, expect, it } from 'vitest';
import { enquiryFirstMessage, firstMessage, waNumber } from './first-message.js';

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

describe('enquiryFirstMessage', () => {
  const slots = { product: 'Custom birthday cake', date: 'Sun 15 Nov', location: null, people: '20 people', budget: 'About RM250' };

  it('greets them by name, names the item, the date and how many, and names no price', () => {
    expect(enquiryFirstMessage('Kek Lina', { name: 'Farah', item: 'Custom birthday cake' }, slots, 'en')).toBe(
      "Hi Farah! This is Kek Lina. Thanks for asking about the Custom birthday cake for Sun 15 Nov (20 people). Let me check the details and I'll come back to you with a price.",
    );
  });

  it('writes in Malay for a Malay page', () => {
    expect(enquiryFirstMessage('Kek Lina', { name: 'Farah', item: 'Kek batik' }, slots, 'ms')).toBe(
      'Hai Farah! Ini Kek Lina. Terima kasih sebab bertanya tentang Kek batik untuk Sun 15 Nov (20 people). Saya semak dulu, nanti saya bagi tahu harganya ya.',
    );
  });

  it('leaves out what it does not know: no name, no item, nothing picked out', () => {
    expect(enquiryFirstMessage('Kek Lina', { name: null, item: null }, null, 'en')).toBe(
      "Hi! This is Kek Lina. Thanks for your enquiry. Let me check the details and I'll come back to you with a price.",
    );
    expect(enquiryFirstMessage('Kek Lina', { name: '  ', item: 'Kek batik' }, { product: null, date: null, location: null }, 'ms')).toBe(
      'Hai! Ini Kek Lina. Terima kasih sebab bertanya tentang Kek batik. Saya semak dulu, nanti saya bagi tahu harganya ya.',
    );
  });
});

describe('waNumber', () => {
  it('keeps only the digits wa.me takes', () => {
    expect(waNumber('+60127814402')).toBe('60127814402');
  });
});
