'use client';

import { useState } from 'react';
import styles from './Bento.module.css';

/**
 * The owner's picture. If it fails to load -- storage down, an object removed
 * -- it disappears and the name stands alone. Never a broken-image icon.
 */
export function Avatar({ src, name }: { src: string; name: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return <img className={styles.avatar} src={src} alt={name} width={56} height={56} onError={() => setFailed(true)} />;
}
