import { Reset } from './reset-form.js';

export default async function ResetPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const params = await searchParams;

  if (!params.token) {
    // Mail clients truncate long URLs. This is a real way to arrive here.
    return <p role="alert">That link looks incomplete. Copy the whole link from the email, or request a new one.</p>;
  }

  return <Reset token={params.token} />;
}
