/**
 * The shop's words, in the page's language. Two languages, like the landing
 * copy: a page whose language is anything else reads English.
 */
export interface ShopCopy {
  visit: string;
  itemCount: (n: number) => string;
  back: string;
  from: (price: string) => string;
  add: string;
  quantity: string;
  basket: (items: number, total: string) => string;
  orderOnWhatsApp: string;
  noWhatsApp: (name: string) => string;
  remove: string;
  pickup: (note: string | null) => string;
  delivery: (fee: string | null) => string;
  notice: (days: number) => string;
  greeting: (shop: string) => string;
  totalLine: (total: string) => string;
  empty: string;
  close: string;
}

const EN: ShopCopy = {
  visit: 'Visit shop',
  itemCount: (n) => `${n} ${n === 1 ? 'item' : 'items'}`,
  back: 'Back',
  from: (price) => `from ${price}`,
  add: 'Add to basket',
  quantity: 'Quantity',
  basket: (items, total) => `${items} in basket · ${total}`,
  orderOnWhatsApp: 'Order on WhatsApp',
  noWhatsApp: (name) => `To order, contact ${name} through the links on their page.`,
  remove: 'Remove',
  pickup: (note) => (note ? `Pickup: ${note}` : 'Pickup available'),
  delivery: (fee) => (fee ? `Delivery: ${fee}` : 'Delivery: rider fee paid separately'),
  notice: (days) => (days === 0 ? 'Same-day orders welcome' : `Order at least ${days} ${days === 1 ? 'day' : 'days'} ahead`),
  greeting: (shop) => `Hi ${shop}, I'd like to order:`,
  totalLine: (total) => `Total: ${total}`,
  empty: 'Nothing for sale right now. Check back soon.',
  close: 'Close',
};

const MS: ShopCopy = {
  visit: 'Lawati kedai',
  itemCount: (n) => `${n} barang`,
  back: 'Kembali',
  from: (price) => `dari ${price}`,
  add: 'Masuk bakul',
  quantity: 'Kuantiti',
  basket: (items, total) => `${items} dalam bakul · ${total}`,
  orderOnWhatsApp: 'Tempah di WhatsApp',
  noWhatsApp: (name) => `Untuk tempah, hubungi ${name} melalui pautan di halaman mereka.`,
  remove: 'Buang',
  pickup: (note) => (note ? `Ambil sendiri: ${note}` : 'Boleh ambil sendiri'),
  delivery: (fee) => (fee ? `Penghantaran: ${fee}` : 'Penghantaran: caj rider dibayar berasingan'),
  notice: (days) => (days === 0 ? 'Tempahan hari yang sama dialu-alukan' : `Tempah sekurang-kurangnya ${days} hari awal`),
  greeting: (shop) => `Hai ${shop}, saya nak tempah:`,
  totalLine: (total) => `Jumlah: ${total}`,
  empty: 'Tiada barang dijual buat masa ini. Datang lagi nanti.',
  close: 'Tutup',
};

export function shopCopy(language: string): ShopCopy {
  return language === 'ms' ? MS : EN;
}
