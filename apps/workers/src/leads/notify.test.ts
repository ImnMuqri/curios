import { describe, expect, it } from 'vitest';
import { buildNotification, replyLanguage } from './notify.js';

const transcript = [
  { role: 'USER' as const, content: 'nak kek butter 2kg' },
  { role: 'ASSISTANT' as const, content: 'RM160 untuk 2kg.' },
  { role: 'USER' as const, content: 'hantar Klang 20 Mac boleh?' },
];

describe('buildNotification', () => {
  it('carries the transcript, which is the thing people pay for', () => {
    // BACKEND.md: "Notification carries the transcript, not just the number.
    // That is the feature people pay for: she opens WhatsApp already knowing
    // what they want."
    const mail = buildNotification({
      displayName: 'Nadia Bakes',
      phone: '+60123456789',
      transcript,
      slots: { product: 'kek butter 2kg', date: '20 Mac', location: 'Klang' },
    });

    expect(mail.text).toContain('nak kek butter 2kg');
    expect(mail.text).toContain('hantar Klang 20 Mac boleh?');
  });

  it('builds a wa.me link WhatsApp will actually open', () => {
    const mail = buildNotification({
      displayName: 'Nadia Bakes',
      phone: '+60123456789',
      transcript,
      slots: { product: null, date: null, location: null },
    });

    // wa.me takes digits with no plus and no separators. A link carrying the
    // plus opens WhatsApp on a broken number, which looks like the product
    // failing at the exact moment it is meant to be earning its keep.
    expect(mail.text).toContain('https://wa.me/60123456789');
    expect(mail.text).not.toContain('wa.me/+60');
  });

  it('prefills the reply, so one tap is enough', () => {
    const mail = buildNotification({
      displayName: 'Nadia Bakes',
      phone: '+60123456789',
      transcript,
      slots: { product: 'kek butter 2kg', date: null, location: null },
    });

    const link = /https:\/\/wa\.me\/60123456789\?text=(\S+)/.exec(mail.text);
    expect(link).not.toBeNull();
    expect(decodeURIComponent(link?.[1] ?? '')).toContain('kek butter 2kg');
  });

  it('names the shop in the subject, because an owner may run more than one', () => {
    const mail = buildNotification({
      displayName: 'Nadia Bakes',
      phone: '+60123456789',
      transcript,
      slots: { product: 'kek', date: '20 Mac', location: null },
    });

    expect(mail.subject).toContain('Nadia Bakes');
  });

  it('works when the model filled nothing in', () => {
    // Extraction can come back empty, and a notification that needs slots to
    // be readable would then be worse than having no slots at all. The number
    // and the transcript are the product; the slots are a convenience.
    const mail = buildNotification({
      displayName: 'Nadia Bakes',
      phone: '+60123456789',
      transcript,
      slots: { product: null, date: null, location: null },
    });

    expect(mail.text).toContain('+60123456789');
    expect(mail.text).toContain('nak kek butter 2kg');
  });

  it('marks who said what, so a transcript reads as a conversation', () => {
    const mail = buildNotification({
      displayName: 'Nadia Bakes',
      phone: '+60123456789',
      transcript,
      slots: { product: null, date: null, location: null },
    });

    // Without attribution the owner cannot tell their own AI's words from the
    // customer's, which is precisely the thing they are reading it to learn.
    const customerLine = mail.text.split('\n').find((line) => line.includes('nak kek butter 2kg'));
    const shopLine = mail.text.split('\n').find((line) => line.includes('RM160 untuk 2kg.'));
    expect(customerLine).not.toBe(shopLine);
    expect(customerLine).toMatch(/customer/i);
  });

  it('prefills in English when the customer wrote English', async () => {
    const english = [
      { role: 'USER' as const, content: 'how much for a 2kg butter cake?' },
      { role: 'ASSISTANT' as const, content: 'RM160.' },
      { role: 'USER' as const, content: 'can you deliver to Klang on 20 March?' },
    ];

    const mail = buildNotification({
      displayName: 'Nadia Bakes',
      phone: '+60123456789',
      transcript: english,
      slots: { product: '2kg butter cake', date: null, location: null },
    });

    const link = /https:\/\/wa\.me\/60123456789\?text=(\S+)/.exec(mail.text);
    const prefilled = decodeURIComponent(link?.[1] ?? '');
    expect(prefilled).toContain('Hi!');
    expect(prefilled).not.toContain('Saya dari');
  });

  it('prefills in Malay when the customer wrote Malay', async () => {
    const mail = buildNotification({
      displayName: 'Nadia Bakes',
      phone: '+60123456789',
      transcript,
      slots: { product: 'kek butter 2kg', date: null, location: null },
    });

    const link = /https:\/\/wa\.me\/60123456789\?text=(\S+)/.exec(mail.text);
    expect(decodeURIComponent(link?.[1] ?? '')).toContain('Saya dari');
  });
});

describe('replyLanguage', () => {
  it('defaults to Malay, which is where a Malaysian shop starts', () => {
    expect(replyLanguage([])).toBe('ms');
    expect(replyLanguage(['2kg', '20 Mac'])).toBe('ms');
  });

  it('reads plain Malay as Malay', () => {
    expect(replyLanguage(['nak kek butter 2kg', 'hantar Klang boleh?'])).toBe('ms');
  });

  it('reads plain English as English', () => {
    expect(replyLanguage(['how much is the butter cake?', 'do you deliver?'])).toBe('en');
  });

  it('reads rojak as Malay', () => {
    // "ada delivery?" is how people actually type. A Malay marker anywhere
    // wins, because a Malay speaker borrowing an English noun is still a
    // Malay speaker -- and DESIGN.md says rojak is fine where a real person
    // would use it.
    expect(replyLanguage(['ada delivery?', 'boleh COD tak?'])).toBe('ms');
  });

  it('reads only the customer, never the shop', () => {
    // The caller passes visitor turns alone. The assistant answers in the
    // language it was asked in, so counting its words would just echo the
    // question back and decide nothing.
    expect(replyLanguage(['can I order for next week?'])).toBe('en');
  });
});
