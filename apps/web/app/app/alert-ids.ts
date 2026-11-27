/**
 * The suspension alert's id: it outranks every other banner on every screen (`pickAlert`).
 * Its own module because the client banner reads it, and alerts.ts pulls in all of @curios/core.
 */
export const SUSPENDED_ALERT_ID = 'suspended';

/** The admin's banner alert: first on every screen (`pickAlert`), and never dismissed. */
export const BANNER_ALERT_ID = 'banner';

/**
 * The page is not public yet. Every screen says so until the owner publishes, except the two that
 * carry the Publish card themselves (`PUBLISH_CARD_SCREENS`), where the banner would only repeat it.
 */
export const UNPUBLISHED_ALERT_ID = 'unpublished';
export const PUBLISH_CARD_SCREENS = ['/app/review', '/app/curios'];
