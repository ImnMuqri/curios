import Link from 'next/link';
import pills from '../_ui/pill-tabs.module.css';
import styles from './settings.module.css';

export const SETTINGS_TABS = ['general', 'notifications'] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

const LABELS: Record<SettingsTab, string> = {
  general: 'General',
  notifications: 'Notifications',
};

/** The tab from `?tab=`. Anything unknown is General, where an owner lands back from linking Google. */
export function parseSettingsTab(raw: string | string[] | undefined): SettingsTab {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return (SETTINGS_TABS as readonly string[]).includes(value ?? '') ? (value as SettingsTab) : 'general';
}

/**
 * Settings in two tabs (owner, 26 Nov): General (the page, signing in, this device) and Notifications
 * (this device's buzz and the emails). Links in the address, like Facts & sources' tabs, so a tab can
 * be linked to and reached with Back; drawn in the dashboard's one tab style.
 */
export function SettingsTabs({ current }: { current: SettingsTab }) {
  return (
    <nav aria-label='Settings' className={`${pills.track} ${styles.tabs}`}>
      {SETTINGS_TABS.map((tab) => (
        <Link key={tab} href={`/app/settings?tab=${tab}`} className={pills.pill} aria-current={tab === current ? 'page' : undefined} scroll={false}>
          {LABELS[tab]}
        </Link>
      ))}
    </nav>
  );
}
