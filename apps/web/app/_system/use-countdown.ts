'use client';

import { useEffect, useState } from 'react';

/** The board's wait before asking for another email: 45 seconds. */
export const RESEND_WAIT_S = 45;

/** Seconds left before "send it again" works, and a way to start the wait. */
export function useCountdown(): [number, () => void] {
  const [left, setLeft] = useState(0);

  useEffect(() => {
    if (left <= 0) return;
    const timer = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(timer);
  }, [left]);

  return [left, () => setLeft(RESEND_WAIT_S)];
}
