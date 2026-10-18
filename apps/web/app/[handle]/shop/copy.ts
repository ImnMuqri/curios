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
  /** The basket bar's way to checkout, when the shop takes orders. */
  checkout: string;
  paused: (name: string) => string;
  // Checkout.
  backToShop: string;
  yourOrder: string;
  addMore: string;
  each: (price: string) => string;
  oneLess: string;
  oneMore: string;
  gettingIt: string;
  pickupOrDelivery: string;
  pickupLabel: string;
  deliveryLabel: string;
  free: string;
  /** A rider's fee is paid to the rider, never added to the order. */
  riderFee: string;
  address: string;
  addressPlaceholder: string;
  day: string;
  dayHint: (noticeDays: number, closedDays: number[]) => string;
  /** A day as its pill shows it: "Sat 17". */
  dayPill: (day: string) => string;
  /** A day in the summary: "Sat 17 Oct". */
  dayLong: (day: string) => string;
  yourDetails: string;
  name: string;
  whatsappNumber: string;
  noteFor: (name: string) => string;
  optional: string;
  notePlaceholder: (name: string) => string;
  items: string;
  pickupOn: string;
  deliveryOn: string;
  pickADay: string;
  total: string;
  payNote: (name: string) => string;
  /** The board's PDPA line: who the number goes to, and no one else. */
  consent: (name: string) => string;
  tooLarge: (name: string) => string;
  deliveryOff: string;
  placeOrder: (total: string) => string;
  emptyBasket: string;
  emptyBasketBody: string;
  pricesChanged: string;
  failed: string;
  // The placed screen.
  orderPlaced: string;
  placedSub: (name: string) => string;
  yourCode: string;
  codeLabel: (code: string) => string;
  copyCode: string;
  copied: string;
  keepCode: string;
  askLater: (name: string, code: string) => string;
  payNow: (total: string) => string;
  sendLink: string;
}

/** `YYYY-MM-DD` read as a calendar day, so its weekday and month never depend on the browser's zone. */
function parts(day: string) {
  const date = new Date(`${day}T00:00:00Z`);
  return { weekday: date.getUTCDay(), date: date.getUTCDate(), month: date.getUTCMonth() };
}

/** Monday first and Sunday last, as a week is said. */
const weekOrder = (days: number[]) => [...new Set(days)].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));

function list(words: string[], and: string): string {
  if (words.length <= 1) return words.join('');
  return `${words.slice(0, -1).join(', ')} ${and} ${words.at(-1)}`;
}

const EN_DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const EN_DAYS = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
const EN_MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MS_DAY = ['Ahd', 'Isn', 'Sel', 'Rab', 'Kha', 'Jum', 'Sab'];
const MS_DAYS = ['Ahad', 'Isnin', 'Selasa', 'Rabu', 'Khamis', 'Jumaat', 'Sabtu'];
const MS_MONTH = ['Jan', 'Feb', 'Mac', 'Apr', 'Mei', 'Jun', 'Jul', 'Ogo', 'Sep', 'Okt', 'Nov', 'Dis'];

function dayWords(short: string[], months: string[]) {
  return {
    dayPill: (day: string) => {
      const p = parts(day);
      return `${short[p.weekday]} ${p.date}`;
    },
    dayLong: (day: string) => {
      const p = parts(day);
      return `${short[p.weekday]} ${p.date} ${months[p.month]}`;
    },
  };
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
  checkout: 'Checkout',
  paused: (name) => `Checkout is paused. Send your basket to ${name} on WhatsApp instead.`,
  backToShop: 'Back to the shop',
  yourOrder: 'Your order',
  addMore: 'Add more',
  each: (price) => `${price} each`,
  oneLess: 'One less',
  oneMore: 'One more',
  gettingIt: 'Getting it',
  pickupOrDelivery: 'Pickup or delivery',
  pickupLabel: 'Pickup',
  deliveryLabel: 'Delivery',
  free: 'Free',
  riderFee: 'Pay the rider',
  address: 'Address',
  addressPlaceholder: 'House number, street, area',
  day: 'Day',
  dayHint: (notice, closed) => {
    const lead = notice === 0 ? 'Same-day orders welcome' : `${notice} ${notice === 1 ? 'day’s' : 'days’'} notice`;
    return closed.length === 0 ? lead : `${lead} · closed ${list(weekOrder(closed).map((d) => EN_DAYS[d] ?? ''), 'and')}`;
  },
  ...dayWords(EN_DAY, EN_MONTH),
  yourDetails: 'Your details',
  name: 'Name',
  whatsappNumber: 'WhatsApp number',
  noteFor: (name) => `Note for ${name}`,
  optional: 'optional',
  notePlaceholder: (name) => `Anything ${name} should know`,
  items: 'Items',
  pickupOn: 'Pickup on',
  deliveryOn: 'Delivery on',
  pickADay: 'Pick a day',
  total: 'Total',
  payNote: (name) => `You pay ${name} directly by DuitNow QR or bank transfer on the next step.`,
  consent: (name) => `Your name and number go to ${name} only.`,
  tooLarge: (name) => `This order is too big to place here. Send your basket to ${name} on WhatsApp instead.`,
  deliveryOff: 'Delivery isn’t offered any more, so this order is for pickup.',
  placeOrder: (total) => `Place order · ${total}`,
  emptyBasket: 'Your basket is empty',
  emptyBasketBody: 'Add something from the shop and it shows up here.',
  pricesChanged: 'Prices changed since you opened the shop. Check your basket and try again.',
  failed: 'Something failed. Try again.',
  orderPlaced: 'Order placed',
  placedSub: (name) => `${name} has it. Pay on the next screen to confirm it.`,
  yourCode: 'Your order code',
  codeLabel: (code) => `Order code ${code}`,
  copyCode: 'Copy code',
  copied: 'Copied',
  keepCode: 'Keep this code.',
  askLater: (name, code) => `Ask ${name}’s page “where is my order ${code}?” any time and it shows you the status.`,
  payNow: (total) => `Pay ${total} now`,
  sendLink: 'Send the link to my WhatsApp',
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
  checkout: 'Daftar keluar',
  paused: (name) => `Tempahan di sini ditangguhkan. Hantar bakul anda kepada ${name} di WhatsApp.`,
  backToShop: 'Kembali ke kedai',
  yourOrder: 'Tempahan anda',
  addMore: 'Tambah lagi',
  each: (price) => `${price} seunit`,
  oneLess: 'Kurang satu',
  oneMore: 'Tambah satu',
  gettingIt: 'Cara terima',
  pickupOrDelivery: 'Ambil sendiri atau penghantaran',
  pickupLabel: 'Ambil sendiri',
  deliveryLabel: 'Penghantaran',
  free: 'Percuma',
  riderFee: 'Bayar rider',
  address: 'Alamat',
  addressPlaceholder: 'Nombor rumah, jalan, kawasan',
  day: 'Hari',
  dayHint: (notice, closed) => {
    const lead = notice === 0 ? 'Tempahan hari yang sama dialu-alukan' : `Notis ${notice} hari`;
    return closed.length === 0 ? lead : `${lead} · tutup hari ${list(weekOrder(closed).map((d) => MS_DAYS[d] ?? ''), 'dan')}`;
  },
  ...dayWords(MS_DAY, MS_MONTH),
  yourDetails: 'Butiran anda',
  name: 'Nama',
  whatsappNumber: 'Nombor WhatsApp',
  noteFor: (name) => `Nota untuk ${name}`,
  optional: 'pilihan',
  notePlaceholder: (name) => `Apa-apa yang ${name} perlu tahu`,
  items: 'Barang',
  pickupOn: 'Ambil pada',
  deliveryOn: 'Hantar pada',
  pickADay: 'Pilih hari',
  total: 'Jumlah',
  payNote: (name) => `Anda bayar terus kepada ${name} melalui DuitNow QR atau pindahan bank pada langkah seterusnya.`,
  consent: (name) => `Nama dan nombor anda hanya pergi kepada ${name}.`,
  tooLarge: (name) => `Tempahan ini terlalu besar untuk dibuat di sini. Hantar bakul anda kepada ${name} di WhatsApp.`,
  deliveryOff: 'Penghantaran tidak lagi ditawarkan, jadi tempahan ini untuk ambil sendiri.',
  placeOrder: (total) => `Buat tempahan · ${total}`,
  emptyBasket: 'Bakul anda kosong',
  emptyBasketBody: 'Tambah sesuatu dari kedai dan ia akan muncul di sini.',
  pricesChanged: 'Harga berubah sejak anda buka kedai. Semak bakul anda dan cuba lagi.',
  failed: 'Ada yang tidak kena. Cuba lagi.',
  orderPlaced: 'Tempahan dibuat',
  placedSub: (name) => `${name} sudah menerimanya. Bayar pada skrin seterusnya untuk mengesahkannya.`,
  yourCode: 'Kod tempahan anda',
  codeLabel: (code) => `Kod tempahan ${code}`,
  copyCode: 'Salin kod',
  copied: 'Disalin',
  keepCode: 'Simpan kod ini.',
  askLater: (name, code) => `Tanya halaman ${name} “mana tempahan saya ${code}?” bila-bila masa dan ia tunjukkan statusnya.`,
  payNow: (total) => `Bayar ${total} sekarang`,
  sendLink: 'Hantar pautan ke WhatsApp saya',
};

export function shopCopy(language: string): ShopCopy {
  return language === 'ms' ? MS : EN;
}
