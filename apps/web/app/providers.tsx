'use client';

import { useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * The one `QueryClient` for the app -- created inside a `useState`
 * initialiser, never at module scope. A module-scope client would be
 * constructed once when the server process starts and then shared across
 * every request it serves, so one visitor's cached data (their own review
 * queue, their own ingestion status) would leak into another visitor's
 * render. `useState`'s initialiser runs once per component instance, which
 * on the server means once per request.
 */
export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient());

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
