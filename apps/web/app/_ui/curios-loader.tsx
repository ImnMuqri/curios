import { Wordmark } from '../_landing/Wordmark.js';
import styles from './curios-loader.module.css';

export const LOADER_LABEL = 'Getting your page ready';

/**
 * The Curios loader: a light full-screen panel with the wordmark (Peek's eye in the "o"), a short
 * track with a sky segment sliding along it, and what is being waited for. No hooks, so a Server
 * Component can put it in the HTML the first paint shows.
 *
 * It fades in after 150ms (CSS, not a timer): a wait shorter than that never shows it. Under
 * `prefers-reduced-motion` the segment holds still and the panel only breathes. Inside the
 * dashboard's frame it takes the frame's dark values (the `--loader-*` hooks, set in app-frame.module.css).
 */
export function CuriosLoader({ label = LOADER_LABEL, className }: { label?: string; className?: string }) {
  return (
    <div className={[styles.loader, className].filter(Boolean).join(' ')} role="status" data-curios-loader>
      <Wordmark className={styles.mark} />
      <span className={styles.track} aria-hidden="true">
        <i className={styles.bar} />
      </span>
      <p className={styles.label}>{label}</p>
    </div>
  );
}
