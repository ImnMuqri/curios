import { describe, expect, it } from 'vitest';
import { questionAskedMail } from './question-mail.js';

const base = { title: 'Do you deliver to Klang?', asks: 3, topicId: 'tp_1', appUrl: 'https://curios.my/', displayName: 'Kek Lina' };

describe('questionAskedMail', () => {
  it('says what keeps being asked, that it is unanswered, and links to the topic', () => {
    const mail = questionAskedMail(base);
    expect(mail.subject).toBe('People keep asking: “Do you deliver to Klang?”');
    expect(mail.text).toContain('asked 3 times and it isn’t answered yet');
    expect(mail.text).toContain('https://curios.my/app/questions?topic=tp_1');
    expect(mail.html).toContain('>Answer it</a>');
    expect(mail.html).toContain('href="https://curios.my/app/questions?topic=tp_1"');
    expect(mail.html).toContain('Settings, under Email me when');
  });

  it('writes no em dash and escapes a visitor’s words', () => {
    const mail = questionAskedMail({ ...base, title: '<b>Hi</b> & you' });
    expect(mail.html).not.toContain('<b>Hi</b>');
    expect(mail.html).toContain('&lt;b&gt;');
    expect(`${mail.subject}${mail.text}${mail.html}`).not.toContain('—');
  });

  it('cuts a very long title', () => {
    const mail = questionAskedMail({ ...base, title: 'x'.repeat(300) });
    expect(mail.subject.length).toBeLessThan(110);
  });
});
