import type { Pricing } from '@curios/core/store';
import type { MyCurios, OwnerStore } from '@curios/db-read';

/** An item as the Store screen holds it: the stored row plus its picture's URL. */
export type EditorItem = OwnerStore['items'][number] & { photoUrl: string | null };

/** What the API returns for an item. Declared here: the web app never imports from apps/api. */
export type ItemRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  category: string | null;
  tag: string | null;
  photoKey: string | null;
  available: boolean;
  priceCents: number | null;
  options: { id: string; label: string; priceCents: number }[];
};

export type ItemPatch = { name?: string; description?: string | null; category?: string | null; tag?: string | null; available?: boolean; pricing?: Pricing };

// Function-typed properties, not method shorthand: they are handed around as
// bare values, and method syntax's implicit `this` trips unbound-method.
export type ItemsApi = {
  add: (input: { name: string; description: string | null; category: string | null; tag: string | null; pricing: Pricing }) => Promise<ItemRow>;
  update: (id: string, patch: ItemPatch) => Promise<ItemRow>;
  remove: (id: string) => Promise<void>;
  reorder: (ids: string[]) => Promise<void>;
  /** Resolves to the public URL of the stored picture. */
  uploadPhoto: (id: string, file: File) => Promise<string>;
  removePhoto: (id: string) => Promise<void>;
};

export type StoreSettings = OwnerStore['settings'];
export type SettingsPatch = Partial<Omit<StoreSettings, 'paymentQrKey'>>;

export type SettingsApi = {
  save: (patch: SettingsPatch) => Promise<StoreSettings>;
  /** Resolves to the public URL of the stored QR. */
  uploadQr: (file: File) => Promise<string>;
  removeQr: () => Promise<void>;
};

/** The owner's own CHIP account, as the Store screen may know it. Never the key. */
export type ChipState = OwnerStore['chip'];

export type ChipApi = {
  /** Checks the Brand ID and secret key with CHIP and stores them; the key is only ever sent, never read back. */
  connect: (brandId: string, secretKey: string) => Promise<ChipState>;
  disconnect: () => Promise<void>;
  /** Starts the RM1 test purchase; resolves to CHIP's checkout URL. */
  test: () => Promise<string>;
};

/** The page's look and words, for the preview's shop. */
export type ShopLook = {
  handle: string;
  displayName: string;
  bio: string | null;
  language: string;
  avatarUrl: string | null;
  coverUrl: string | null;
  style: MyCurios['style'];
  accentColor: string;
  headingFont: MyCurios['headingFont'];
  background: MyCurios['background'];
  backgroundColor: string | null;
  socials: MyCurios['socials'];
  /** The number the basket is sent to, from the page's links; null when there is none. */
  whatsapp: string | null;
};

