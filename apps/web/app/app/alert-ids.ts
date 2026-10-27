/**
 * The suspension alert's id: it outranks every other banner on every screen (`pickAlert`).
 * Its own module because the client banner reads it, and alerts.ts pulls in all of @curios/core.
 */
export const SUSPENDED_ALERT_ID = 'suspended';

/** The admin's banner alert: first on every screen (`pickAlert`), and never dismissed. */
export const BANNER_ALERT_ID = 'banner';
