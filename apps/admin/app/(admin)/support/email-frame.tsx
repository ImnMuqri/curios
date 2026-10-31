'use client';

import { useState } from 'react';
import { buildEmailDocument, hasRemoteImages } from './email-document.js';
import styles from './support.module.css';

/**
 * One email's HTML, in a frame that can run nothing and reach nothing. No allow-scripts and no
 * allow-same-origin, ever: links still open in a new tab (allow-popups), outside the sandbox. Such a
 * frame cannot be measured from here, so it has a fixed height and scrolls inside.
 * Show images is per message and forgotten on the next one: remote images are how senders track opens.
 */
export function EmailFrame({ html, text }: { html: string | null; text: string | null }) {
  const [showRemoteImages, setShowRemoteImages] = useState(false);

  return (
    <div className={styles.frameWrap}>
      {!showRemoteImages && hasRemoteImages(html) && (
        <p className={styles.blocked}>
          Remote images are hidden.
          <button type="button" className={styles.link} onClick={() => setShowRemoteImages(true)}>
            Show images
          </button>
        </p>
      )}
      <iframe
        className={styles.frame}
        sandbox="allow-popups allow-popups-to-escape-sandbox"
        srcDoc={buildEmailDocument({ html, text, showRemoteImages })}
        title="Email"
      />
    </div>
  );
}
