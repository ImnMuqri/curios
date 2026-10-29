import type { Metadata } from 'next';
import { connectToApi } from '../../lib/api-hints.js';
import { getAuthLink } from '@curios/db-read';
import { BadLink } from '../_system/BadLink.js';
import { Reset } from './reset-form.js';

export const metadata: Metadata = { title: 'Choose a new password · Curios', robots: { index: false, follow: false } };

/**
 * Choose a new password, from the System board. The link is looked at (not
 * spent) first: a link cut short by a mail client, more than an hour old or
 * already used goes straight to "That link doesn't work", and a good one
 * names the address it is for.
 */
export default async function ResetPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  connectToApi();
  const { token } = await searchParams;
  if (!token) return <BadLink />;

  const link = await getAuthLink(token, 'PASSWORD_RESET');
  if (link.state !== 'usable') return <BadLink />;

  return <Reset token={token} email={link.email} />;
}
