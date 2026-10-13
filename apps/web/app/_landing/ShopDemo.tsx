'use client';

import { useEffect, useRef, useState } from 'react';
import { ShopView } from '../[handle]/shop/shop-view.js';
import type { LandingCopy } from './copy.js';
import styles from './shop.module.css';

/** Kek Lina's shelf, the real component, as a demo: the order button shows the message instead of opening WhatsApp. */
export function ShopDemo({ locale, shop, text }: { locale: LandingCopy['locale']; shop: LandingCopy['shop']; text: LandingCopy['shopSection'] }) {
  const [message, setMessage] = useState<string | null>(null);
  const panel = useRef<HTMLElement>(null);
  // The message lands below the basket bar, often off-screen on a phone: focus takes the visitor to it and has it read out.
  useEffect(() => {
    if (message) panel.current?.focus();
  }, [message]);
  const { page, items } = shop;
  return (
    <div className={styles.demo}>
      <ShopView
        handle={page.handle}
        displayName={page.displayName}
        language={locale}
        items={items.map((item) => ({ ...item, photoKey: null }))}
        whatsapp={null}
        pickupEnabled
        pickupNote="Seksyen 7, Shah Alam"
        deliveryMode="RIDER"
        deliveryFeeCents={null}
        minNoticeDays={2}
        initialItemId={null}
        onOrder={setMessage}
        orderLabel={text.orderButton}
        showBack={false}
        storageKey="curios-landing-demo"
        variant="embedded"
      />
      {message ? (
        <section ref={panel} tabIndex={-1} className={styles.message} aria-label={text.messageTitle}>
          <h3 className={styles.messageTitle}>{text.messageTitle}</h3>
          <pre className={styles.messageText}>{message}</pre>
        </section>
      ) : null}
      <p className={styles.note}>{text.demoNote}</p>
    </div>
  );
}
