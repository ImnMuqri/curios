'use client';

import { usePathname } from 'next/navigation';
import { Nav } from '@curios/ui';

const ITEMS = [
  { href: '/app/review', label: 'Review' },
  { href: '/app/questions', label: 'Questions' },
  { href: '/app/leads', label: 'Leads' },
  { href: '/app/billing', label: 'Billing' },
  { href: '/app/settings', label: 'Settings' },
];

/**
 * Reads the pathname so Nav can mark where you are.
 *
 * AppLayout is a Server Component and cannot call usePathname itself, and
 * Nav cannot either -- @curios/ui does not import Next. This is the one
 * place that bridges the two.
 */
export function AppNav() {
  const pathname = usePathname();
  return <Nav items={ITEMS} current={pathname ?? undefined} />;
}
