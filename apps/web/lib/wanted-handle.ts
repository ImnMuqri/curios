/**
 * The handle someone typed into the landing page's `curios.my/` field, carried
 * across sign-up and email verification to the claim screen.
 *
 * Browser storage, deliberately: sign-up is several pages and an email apart,
 * and nothing about this needs a server. If storage is blocked or empty, the
 * claim screen simply starts blank, which is what it did before. The claim
 * screen still checks the handle for real; this is only a pre-fill.
 */
const KEY = 'curios:wanted-handle';

/** Only what a handle can contain, lowercased and capped -- the claim screen does the real check. */
export function tidyHandle(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^@/, '')
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 30);
}

export function rememberWantedHandle(raw: string): void {
  const handle = tidyHandle(raw);
  try {
    if (handle) window.localStorage.setItem(KEY, handle);
    else window.localStorage.removeItem(KEY);
  } catch {
    // Private mode or blocked storage: the claim screen starts blank instead.
  }
}

export function readWantedHandle(): string {
  try {
    return tidyHandle(window.localStorage.getItem(KEY) ?? '');
  } catch {
    return '';
  }
}

export function forgetWantedHandle(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Nothing to clean up if storage was never reachable.
  }
}

/**
 * Fired on window as someone types into a curios.my/ field, with the tidied
 * handle as `detail`, so the demo page beside it can show their address live.
 */
export const HANDLE_TYPED_EVENT = 'curios:handle-typed';
