'use client';

import { useState } from 'react';
import { ShopView } from '../[handle]/shop/shop-view.js';
import type { LandingCopy } from './copy.js';
import styles from './shop.module.css';

/** Kek Lina's shelf, the real component, as a demo: the order button shows the message instead of opening WhatsApp. */
export function ShopDemo({ copy }: { copy: LandingCopy }) {
  const [message, setMessage] = useState<string | null>(null);
  const { page, items } = copy.shop;
  return (
    <div className={styles.demo}>
      <ShopView
        handle={page.handle}
        displayName={page.displayName}
        language={copy.locale}
        items={items.map((item) => ({ ...item, photoKey: null }))}
        whatsapp={null}
        pickupEnabled
        pickupNote="Seksyen 7, Shah Alam"
        deliveryMode="RIDER"
        deliveryFeeCents={null}
        minNoticeDays={2}
        initialItemId={null}
        onOrder={setMessage}
        orderLabel={copy.shopSection.orderButton}
        showBack={false}
        storageKey="curios-landing-demo"
        variant="embedded"
      />
      {message ? (
        <section className={styles.message} aria-label={copy.shopSection.messageTitle}>
          <h3 className={styles.messageTitle}>{copy.shopSection.messageTitle}</h3>
          <pre className={styles.messageText}>{message}</pre>
        </section>
      ) : null}
      <p className={styles.note}>{copy.shopSection.demoNote}</p>
    </div>
  );
}
