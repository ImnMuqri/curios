import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getShopItem } from '@curios/db-read';
import { formatRinggit, fromPrice } from '@curios/core/store';
import { PageTheme } from '../../../_bento/BentoPage.js';
import { avatarUrl } from '../../../../lib/avatar-url.js';
import { nextOrderDay } from '../pill.js';
import { ProductView } from './product-view.js';
import styles from './product.module.css';

// Read live, like the shop: an item turned off must stop opening on the next request.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = Promise<{ handle: string; slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { handle, slug } = await params;
  const found = await getShopItem(handle, slug);
  if (!found) return {};
  const { shop, item } = found;
  const photo = avatarUrl(item.photoKey);
  const from = fromPrice(item);
  const description = item.description ?? (from === null ? `${item.name} · ${shop.displayName}` : `${item.name} from ${formatRinggit(from)} · ${shop.displayName}`);
  return {
    title: `${item.name} · ${shop.displayName}`,
    description,
    openGraph: { title: `${item.name} · ${shop.displayName}`, description, ...(photo ? { images: [{ url: photo }] } : {}) },
  };
}

export default async function ProductPage({ params }: { params: Params }) {
  const { handle, slug } = await params;
  // Unknown, taken down, another shop's, a closed shop or a personal page: all one 404.
  const found = await getShopItem(handle, slug);
  if (!found) notFound();
  const { shop, item } = found;

  return (
    <main>
      <PageTheme theme={shop} className={styles.stage}>
        <div className={styles.column}>
          <ProductView
            handle={shop.handle}
            displayName={shop.displayName}
            language={shop.language}
            item={{ ...item, photoUrl: avatarUrl(item.photoKey) }}
            items={shop.items}
            halal={shop.shopHalal}
            noticeDays={shop.minNoticeDays}
            nextDay={nextOrderDay(shop, new Date())}
            pickup={shop.pickupEnabled}
          />
        </div>
      </PageTheme>
    </main>
  );
}
