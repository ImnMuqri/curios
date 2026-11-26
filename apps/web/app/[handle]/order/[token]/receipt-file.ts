import { RECEIPT_MAX_BYTES } from '@curios/core/orders';

// The receipt's file rules, shared by the order page's upload and checkout's pay-first picker.
/** What the API takes; it checks the first bytes too, so this is only the early word. */
export const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  pdf: 'application/pdf',
};

/** The first bytes of the four kinds, as the API's decodeReceipt checks them. */
function sniff(bytes: Uint8Array): string | null {
  const at = (offset: number, text: string) => [...text].every((ch, i) => bytes[offset + i] === ch.charCodeAt(0));
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes[0] === 0x89 && at(1, 'PNG')) return 'image/png';
  if (at(0, 'RIFF') && at(8, 'WEBP')) return 'image/webp';
  if (at(0, '%PDF')) return 'application/pdf';
  return null;
}

function head(file: File): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsArrayBuffer(file.slice(0, 12));
  });
}

/**
 * The file's type as it is sent. Some Android pickers give no type at all;
 * then the extension says, and failing that its first bytes. The API checks
 * the bytes against this label either way, so the server has the last word.
 */
export async function typeOf(file: File): Promise<string | null> {
  if (file.type) return ACCEPTED.includes(file.type) ? file.type : null;
  const ext = file.name.includes('.') ? (file.name.split('.').pop()?.toLowerCase() ?? '') : '';
  return BY_EXTENSION[ext] ?? sniff(await head(file).catch(() => new Uint8Array()));
}

/** The file as base64, without the data URL's prefix. */
export function base64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    // readAsDataURL always yields a string.
    reader.onload = () => resolve((reader.result as string).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(file);
  });
}

/** Whether a chosen file passes the early check (the API checks the bytes too). */
export const receiptTooBig = (file: File): boolean => file.size > RECEIPT_MAX_BYTES;
