import { CHROME } from '../_legal/content.js';
import styles from './site.module.css';

/** The small footer under the auth screens: "© Curios · Terms · Privacy · Bahasa Melayu". */
export function SiteFooterLine() {
  return (
    <footer className={styles.line}>
      <span>© Curios</span>
      <a href="/terms">{CHROME.en.tab.terms}</a>
      <a href="/privacy">{CHROME.en.tab.privacy}</a>
      <a href="/ms" lang="ms" hrefLang="ms">
        Bahasa Melayu
      </a>
    </footer>
  );
}
