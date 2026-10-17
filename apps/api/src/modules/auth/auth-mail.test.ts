import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { alreadySignedUpMail, resetMail, verifyMail } from './auth-mail.js';

let saved: string | undefined;
beforeEach(() => {
  saved = process.env.APP_URL;
  process.env.APP_URL = 'https://curios.my/';
});
afterEach(() => {
  if (saved === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = saved;
});

describe('the account emails', () => {
  it('confirm: the link as a button and as plain text, with the words it always had', () => {
    const mail = verifyMail('tok123');

    expect(mail.subject).toBe('Confirm your email');
    expect(mail.text).toBe('Confirm your address to finish setting up Curios:\n\nhttps://curios.my/verify?token=tok123');
    expect(mail.html).toContain('href="https://curios.my/verify?token=tok123"');
    expect(mail.html).toContain('>Confirm my email</a>');
    expect(mail.html).toContain('Button not working?');
  });

  it('reset: names the address, and says it works once and expires in an hour, in both', () => {
    const mail = resetMail('tok456', 'lina@keklina.example');

    expect(mail.text).toContain('Someone asked to reset the password for lina@keklina.example. If that was you, choose a new one.');
    expect(mail.html).toContain('Your password stays the same.');

    expect(mail.text).toContain('https://curios.my/reset?token=tok456');
    expect(mail.text).toContain('This link works once and expires in an hour.');
    expect(mail.html).toContain('>Choose a new password</a>');
    expect(mail.html).toContain('This link works once and expires in an hour.');
  });

  it('already signed up: sends them to sign in, or to reset, and changes nothing', () => {
    const mail = alreadySignedUpMail();

    expect(mail.subject).toBe('You already have a Curios account');
    expect(mail.html).toContain('href="https://curios.my/signin"');
    expect(mail.html).toContain('href="https://curios.my/forgot"');
    expect(mail.text).not.toContain('--');
    expect(mail.html).toContain('Nothing has changed on your account.');
  });
});
