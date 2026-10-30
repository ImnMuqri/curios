import { digitalFacts, type DigitalFacts } from '@curios/core/digital';
import type { Frame } from '@curios/core/item-photos';
import type { Pricing } from '@curios/core/store';
import type { OwnerVoucher, VoucherInput } from '@curios/core/vouchers';
import type { MyCurios, OwnerStore } from '@curios/db-read';

export type { Frame };

/** One photo as the owner holds it: its square's key, the original's size, and the owner's crop. */
export type OwnerPhoto = { id: string; squareKey: string; width: number; height: number; frame: Frame };

/** What every photo call answers: the item's photos in order, and the key of the cover (the first one's 512). */
export type PhotosResult = { photos: OwnerPhoto[]; photoKey: string | null };

/** An item as the Store screen holds it: the stored row plus its picture's URL. */
export type EditorItem = OwnerStore['items'][number] & { photoUrl: string | null };

/** The digital fields of an item that is not digital: what a physical item holds. The editor for digital items builds on the rest. */
export const PHYSICAL_ITEM = {
  kind: 'PHYSICAL',
  delivery: null,
  accessUrl: null,
  accessNote: null,
  sessionMinutes: null,
  sessionPlace: null,
  sessionWhere: null,
  photos: [],
  files: [],
  codesLeft: 0,
  sessions: [],
} as const satisfies Pick<EditorItem, 'kind' | 'delivery' | 'accessUrl' | 'accessNote' | 'sessionMinutes' | 'sessionPlace' | 'sessionWhere' | 'photos' | 'files' | 'codesLeft' | 'sessions'>;

/** An editor item as the shop draws it: the owner's counts turned into what a visitor is shown. */
export function previewItem(item: EditorItem, now = new Date()): Omit<EditorItem, keyof DigitalFacts | 'files' | 'codesLeft' | 'accessUrl' | 'accessNote' | 'sessionWhere' | 'sessionMinutes' | 'sessionPlace'> & DigitalFacts {
  const { files, codesLeft, sessions, accessUrl, accessNote: _note, sessionWhere: _where, sessionMinutes, sessionPlace, ...rest } = item;
  return {
    ...rest,
    ...digitalFacts(
      {
        kind: item.kind,
        delivery: item.delivery,
        accessUrl,
        sessionMinutes,
        sessionPlace,
        files: files.map((f) => ({ name: f.name, contentType: '' })),
        codesLeft,
        sessions: sessions.map((t) => ({ id: t.id, startsAt: t.startsAt, seats: t.seats, booked: t.booked })),
      },
      now,
    ),
  };
}

/** What the API returns for an item. Declared here: the web app never imports from apps/api. */
export type ItemRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  category: string | null;
  tag: string | null;
  sku: string | null;
  photoKey: string | null;
  available: boolean;
  priceCents: number | null;
  options: { id: string; label: string; priceCents: number }[];
  kind: 'PHYSICAL' | 'DIGITAL';
  delivery: Delivery | null;
  accessUrl: string | null;
  accessNote: string | null;
  sessionMinutes: number | null;
  sessionPlace: 'ONLINE' | 'IN_PERSON' | null;
  sessionWhere: string | null;
  photos: OwnerPhoto[];
  files: { id: string; name: string; sizeBytes: number }[];
  codesLeft: number;
  /** `startsAt` is an ISO string on the wire. */
  sessions: { id: string; startsAt: string; seats: number; booked: number; seatsLeft: number }[];
};

/** What the API says for an item that is not digital. */
export const PHYSICAL_ROW: Pick<ItemRow, 'kind' | 'delivery' | 'accessUrl' | 'accessNote' | 'sessionMinutes' | 'sessionPlace' | 'sessionWhere' | 'photos' | 'files' | 'codesLeft' | 'sessions'> = { kind: 'PHYSICAL', delivery: null, accessUrl: null, accessNote: null, sessionMinutes: null, sessionPlace: null, sessionWhere: null, photos: [], files: [], codesLeft: 0, sessions: [] };

export type Delivery = 'FILES' | 'LINK' | 'CODES' | 'SESSION';

/** The digital fields of an item as the API takes them: a physical item sends only its kind, which clears the rest. */
export type DigitalFields =
  | { kind: 'PHYSICAL' }
  | { kind: 'DIGITAL'; delivery: Delivery; accessUrl?: string; accessNote?: string | null; sessionMinutes?: number; sessionPlace?: 'ONLINE' | 'IN_PERSON'; sessionWhere?: string };

export type ItemPatch = { name?: string; description?: string | null; category?: string | null; tag?: string | null; sku?: string | null; available?: boolean; pricing?: Pricing } & Partial<DigitalFields>;

export type StoredFile = { id: string; name: string; sizeBytes: number };
export type StoredSession = { id: string; startsAt: string; seats: number; booked: number; seatsLeft: number };

// Function-typed properties, not method shorthand: they are handed around as
// bare values, and method syntax's implicit `this` trips unbound-method.
export type ItemsApi = {
  add: (input: { name: string; description: string | null; category: string | null; tag: string | null; sku: string | null; pricing: Pricing; digital?: DigitalFields }) => Promise<ItemRow>;
  update: (id: string, patch: ItemPatch) => Promise<ItemRow>;
  remove: (id: string) => Promise<void>;
  reorder: (ids: string[]) => Promise<void>;
  /** Adds a photo: the prepared original and the owner's crop of it. */
  addPhoto: (id: string, blob: Blob, frame: Frame) => Promise<PhotosResult>;
  recropPhoto: (id: string, photoId: string, frame: Frame) => Promise<PhotosResult>;
  /** Puts a new picture in a photo's place, with a new crop. */
  replacePhoto: (id: string, photoId: string, blob: Blob, frame: Frame) => Promise<PhotosResult>;
  removePhoto: (id: string, photoId: string) => Promise<PhotosResult>;
  reorderPhotos: (id: string, ids: string[]) => Promise<PhotosResult>;
  /** The public URL of a stored picture, from its key. */
  photoUrl: (key: string) => string;
  /** Where the owner's original can be shown from: the API sends it on to storage. */
  originalUrl: (id: string, photoId: string) => string;
  /** Sends one file's bytes, telling `onProgress` how far along it is (0 to 1). */
  uploadFile: (id: string, file: File, onProgress: (done: number) => void) => Promise<StoredFile>;
  removeFile: (id: string, fileId: string) => Promise<void>;
  /** Adds the pasted codes (the API drops blanks and ones it has); says how many were new and how many are left to give out. */
  addCodes: (id: string, text: string) => Promise<{ added: number; left: number }>;
  /** `startsAt` carries its UTC offset. */
  addSession: (id: string, input: { startsAt: string; seats: number }) => Promise<StoredSession>;
  updateSession: (id: string, sessionId: string, patch: { startsAt?: string; seats?: number }) => Promise<StoredSession>;
  removeSession: (id: string, sessionId: string) => Promise<void>;
};

export type StoreSettings = OwnerStore['settings'];
export type SettingsPatch = Partial<Omit<StoreSettings, 'paymentQrKey'>>;

export type SettingsApi = {
  save: (patch: SettingsPatch) => Promise<StoreSettings>;
  /** Resolves to the public URL of the stored QR. */
  uploadQr: (file: File) => Promise<string>;
  removeQr: () => Promise<void>;
};

export type VouchersApi = {
  add: (input: VoucherInput) => Promise<OwnerVoucher>;
  update: (id: string, patch: Partial<VoucherInput> & { active?: boolean }) => Promise<OwnerVoucher>;
  remove: (id: string) => Promise<void>;
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

