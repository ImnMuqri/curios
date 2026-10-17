import { ACCOUNT_MAIL_FOOTER, renderMailHtml, type MailJobData } from '@curios/core';

type Mail = Omit<MailJobData, 'to'>;

const appUrl = () => (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/+$/, '');

/**
 * The three account emails, laid out as the design handoff's Emails board
 * draws them: one button and a plain-link fallback. The words are the ones
 * these emails already had (the handoff keeps them), set into the layout.
 */
export function verifyMail(token: string): Mail {
  const url = `${appUrl()}/verify?token=${token}`;
  return {
    subject: 'Confirm your email',
    text: `Confirm your address to finish setting up Curios:\n\n${url}`,
    html: renderMailHtml({
      subject: 'Confirm your email',
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

export function resetMail(token: string): Mail {
  const url = `${appUrl()}/reset?token=${token}`;
  return {
    subject: 'Reset your password',
    text: `Choose a new password:\n\n${url}\n\nThis link works once and expires in an hour. If you did not ask for it, ignore this message.`,
    html: renderMailHtml({
      subject: 'Reset your password',
      heading: 'Reset your password',
      blocks: [
        { kind: 'p', text: 'Choose a new password.' },
        { kind: 'buttons', primary: { label: 'Choose a new password', href: url } },
        { kind: 'small', text: 'This link works once and expires in an hour. If you did not ask for it, ignore this message.' },
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
    text: 'Someone tried to sign up with this address. You already have an account, so sign in instead. If that was not you, you can ignore this message.',
    html: renderMailHtml({
      subject: 'You already have a Curios account',
      heading: 'You already have a Curios account',
      blocks: [
        { kind: 'p', text: 'Someone tried to sign up with this address. You already have an account, so sign in instead.' },
        { kind: 'buttons', primary: { label: 'Sign in', href: `${base}/signin` }, secondary: { label: 'Forgot password', href: `${base}/forgot` } },
        { kind: 'small', text: 'If that was not you, you can ignore this message.' },
      ],
      footer: ACCOUNT_MAIL_FOOTER,
    }),
  };
}
