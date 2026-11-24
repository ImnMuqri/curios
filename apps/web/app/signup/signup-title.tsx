import styles from '../auth.module.css';

/** The headline, with its one pink word. Server-safe: the page's "Curios is full" state and the form both use it. */
export const SIGNUP_TITLE = (
  <>
    Create your <span className={styles.hl}>free</span> page.
  </>
);
