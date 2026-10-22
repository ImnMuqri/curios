import { ACCOUNT_MAIL_FOOTER, renderMailHtml, type MailJobData } from '@curios/core';

type Mail = Omit<MailJobData, 'to'>;

const appUrl = () => (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/+$/, '');

/**
 * The three account emails, laid out and worded as the design handoff's
 * Emails board draws them: one button and a plain-link fallback.
 */
export function verifyMail(token: string): Mail {
  const url = `${appUrl()}/verify?token=${token}`;
  return {
    subject: 'Confirm your email',
    text: `Confirm your address to finish setting up Curios:\n\n${url}`,
    html: renderMailHtml({
      subject: 'Confirm your email',
      appUrl: appUrl(),
      heading: 'Confirm your email',
      blocks: [
        { kind: 'p', text: 'Confirm your address to finish setting up Curios.' },
        { kind: 'buttons', primary: { label: 'Confirm my email', href: url } },
        { kind: 'fallback', url },
        { kind: 'small', text: 'If you didn’t sign up for Curios, you can ignore this message.' },
      ],
      footer: ACCOUNT_MAIL_FOOTER,
    }),
  };
}

export function resetMail(token: string, email: string): Mail {
  const url = `${appUrl()}/reset?token=${token}`;
  const asked = `Someone asked to reset the password for ${email}. If that was you, choose a new one.`;
  const once = 'This link works once and expires in an hour. If you did not ask for it, ignore this message. Your password stays the same.';
  return {
    subject: 'Reset your password',
    text: `${asked}\n\n${url}\n\n${once}`,
    html: renderMailHtml({
      subject: 'Reset your password',
      appUrl: appUrl(),
      heading: 'Reset your password',
      blocks: [
        { kind: 'p', text: asked },
        { kind: 'buttons', primary: { label: 'Choose a new password', href: url } },
        { kind: 'small', text: once },
        { kind: 'fallback', url },
      ],
      footer: ACCOUNT_MAIL_FOOTER,
    }),
  };
}

export function alreadySignedUpMail(): Mail {
  const base = appUrl();
  return {
    subject: 'You already have a Curios account',
    text: 'Someone tried to sign up with this address. You already have an account, so sign in instead. If that was not you, you can ignore this message. Nothing has changed on your account.',
    html: renderMailHtml({
      subject: 'You already have a Curios account',
      appUrl: appUrl(),
      heading: 'You already have a Curios account',
      blocks: [
        { kind: 'p', text: 'Someone tried to sign up with this address. You already have an account, so sign in instead.' },
        { kind: 'buttons', primary: { label: 'Sign in', href: `${base}/signin` }, secondary: { label: 'Forgot password', href: `${base}/forgot` } },
        { kind: 'small', text: 'If that was not you, you can ignore this message. Nothing has changed on your account.' },
      ],
      footer: ACCOUNT_MAIL_FOOTER,
    }),
  };
}
