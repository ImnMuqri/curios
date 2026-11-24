'use client';

import { useSearchParams } from 'next/navigation';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

/**
 * Whether the pay dialog is open, shared by everything on Billing that can open it: the Pay button,
 * the renewal-failed card's "Pay another way" and the payment toast's "Try again". Without a provider
 * (a test, a bare story) PlanPay keeps its own state.
 */
const PayDialogContext = createContext<{ open: boolean; setOpen: (open: boolean) => void } | null>(null);

export function PayDialogProvider({ initialOpen = false, children }: { initialOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(initialOpen);
  // A client-side move to ?pay=1 while already on Billing opens it too, not only a fresh load.
  const wantsPay = useSearchParams()?.get('pay') === '1';
  useEffect(() => {
    if (wantsPay) setOpen(true);
  }, [wantsPay]);
  const value = useMemo(() => ({ open, setOpen }), [open]);
  return <PayDialogContext.Provider value={value}>{children}</PayDialogContext.Provider>;
}

/** The shared dialog state, or null outside a provider. */
export function usePayDialog() {
  return useContext(PayDialogContext);
}
