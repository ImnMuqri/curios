import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

/** The tab's name: "Curios - Billing" (the dashboard layout's template). */
export const metadata: Metadata = { title: 'Billing' };

/**
 * Where CHIP's return used to land after a paid plan. The result is now a toast on Billing, but old links
 * (an email, the browser history) keep working: this sends them to Billing with the same payment id, which
 * Billing looks up for the signed-in owner and shows only if its own record says so.
 */
export default async function PaidPage({ searchParams }: { searchParams: Promise<{ payment?: string }> }) {
  const { payment } = await searchParams;
  if (!payment) redirect('/app/billing');
  redirect(`/app/billing?paid=${encodeURIComponent(payment)}`);
}
