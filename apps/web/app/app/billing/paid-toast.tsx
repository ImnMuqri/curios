'use client';

import { useEffect } from 'react';
import { useToast } from '../_ui/toast.js';

/**
 * Back from Billplz with the payment confirmed: the board's toast, "Paid.
 * You're covered until 14 Dec 2026." The address loses its `?payment=paid`
 * so a reload does not say it twice -- through the history API, not the
 * router, which would render the page again without this toast.
 */
export function PaidToast({ until }: { until: string }) {
  const { say, toast } = useToast(2800);

  useEffect(() => {
    say(`Paid. You’re covered until ${until}.`);
    window.history.replaceState(null, '', '/app/billing');
    // Once, on arrival.
  }, []);

  return toast;
}
