import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getPublicShop } from '@curios/db-read';
import { BentoPage } from '../../_bento/BentoPage.js';
import { avatarUrl, coverUrl } from '../../../lib/avatar-url.js';
import { whatsappNumber } from './basket.js';
import { ShopView } from './shop-view.js';

// Read live, like /[handle]: an item turned off must leave the shelf on the next request.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ handle: string }> }): Promise<Metadata> {
  const { handle } = await params;
  const shop = await getPublicShop(handle);
  if (!shop) return {};
  return { title: `${shop.displayName} · Shop` };
}

export default async function ShopPage({
  params,
  searchParams,
}: {
  params: Promise<{ handle: string }>;
  searchParams: Promise<{ item?: string }>;
}) {
  const { handle } = await params;
  const { item } = await searchParams;
  const shop = await getPublicShop(handle);
  if (!shop) notFound();

  return (
    <main>
      <BentoPage
        displayName={shop.displayName}
        handle={shop.handle}
        bio={shop.bio}
        avatarUrl={avatarUrl(shop.avatarKey)}
        links={[]}
        style={shop.style}
        accentColor={shop.accentColor}
        headingFont={shop.headingFont}
        background={shop.background}
        backgroundColor={shop.backgroundColor}
        coverUrl={coverUrl(shop.coverKey)}
        language={shop.language}
        // Only its presence matters here: it is what gives the page its Shop tab.
        shop={{ position: 0, size: null, label: '', caption: '', photoUrl: null }}
        mode="shop"
        stage
      >
        <ShopView
          handle={shop.handle}
          displayName={shop.displayName}
          language={shop.language}
          items={shop.items.map((i) => ({ ...i, photoUrl: avatarUrl(i.photoKey) }))}
          whatsapp={whatsappNumber(shop.links)}
          pickupEnabled={shop.pickupEnabled}
          pickupNote={shop.pickupNote}
          deliveryMode={shop.deliveryMode}
          deliveryFeeCents={shop.deliveryFeeCents}
          minNoticeDays={shop.minNoticeDays}
          initialItemId={item ?? null}
          // The page's Links tab is the way back.
          showBack={false}
        />
      </BentoPage>
    </main>
  );
}
