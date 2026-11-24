import { redirect } from 'next/navigation';

/**
 * Where CHIP's return used to land after a plan payment that did not complete. The result is now a toast
 * on Billing, but old links keep working: this sends them there with the same payment id.
 */
export default async function FailedPage({ searchParams }: { searchParams: Promise<{ payment?: string }> }) {
  const { payment } = await searchParams;
  if (!payment) redirect('/app/billing');
  redirect(`/app/billing?failed=${encodeURIComponent(payment)}`);
}
