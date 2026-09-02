import { Verify } from './verify-client.js';

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const params = await searchParams;

  return <Verify token={params.token} />;
}
