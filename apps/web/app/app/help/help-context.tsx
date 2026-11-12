'use client';

import { createContext, useContext } from 'react';

export const SUPPORT_MAILTO = 'mailto:support@curios.my';

export interface HelpControl {
  open: boolean;
  show: () => void;
  close: () => void;
  toggle: () => void;
}

/**
 * Whether the Help panel is open, and the way to open it from anywhere in the dashboard: the top
 * bar's Help, the account menu's Help & support, a screen's "Ask for help". Null outside the frame
 * (a bare page), where those fall back to emailing support.
 */
export const HelpContext = createContext<HelpControl | null>(null);

export function useHelp(): HelpControl | null {
  return useContext(HelpContext);
}

/** "Ask for help" on a screen: opens the panel, or emails support where there is no panel. */
export function AskForHelp({ className, children }: { className?: string; children: React.ReactNode }) {
  const help = useHelp();
  if (!help) {
    return (
      <a className={className} href={SUPPORT_MAILTO}>
        {children}
      </a>
    );
  }
  return (
    <button type="button" className={className} onClick={help.show} aria-expanded={help.open}>
      {children}
    </button>
  );
}
