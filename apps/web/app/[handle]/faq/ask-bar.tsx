import styles from './faq.module.css';

/**
 * "Ask {shop} anything" (More board, `.askb.in`): a field that opens the page's chat with what was typed in
 * it, as the product page's "Ask about this" does (`/{handle}?q=…#ask`; the page reads it and types it
 * into the box without sending it). A plain GET form, so it works before any script has loaded.
 */
export function AskBar({ handle, placeholder, send }: { handle: string; placeholder: string; send: string }) {
  return (
    <form className={styles.askBar} method="get" action={`/${handle}#ask`}>
      <input name="q" maxLength={500} placeholder={placeholder} aria-label={placeholder} autoComplete="off" />
      <button type="submit" aria-label={send}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 19V5M6 11l6-6 6 6" />
        </svg>
      </button>
    </form>
  );
}
