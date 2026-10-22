/**
 * The shop's words, in the page's language. Two languages, like the landing
 * copy: a page whose language is anything else reads English.
 */
export interface ShopCopy {
  visit: string;
  /** The shop pill's title. */
  shop: string;
  itemCount: (n: number) => string;
  /** The shop pill's second half, after the item count: the day the next order could be for. */
  nextPickup: (day: string) => string;
  nextDelivery: (day: string) => string;
  /** The basket bar's count and total, and its small line on the Links tab. */
  barText: (items: number, total: string) => string;
  stillInBasket: string;
  /** The shop page: the basket bar's small line, and the facts under the name. */
  barPickup: (day: string) => string;
  barDelivery: (day: string) => string;
  factNextPickup: (day: string) => string;
  factNextDelivery: (day: string) => string;
  backTo: (name: string) => string;
  shareShop: string;
  linkCopied: string;
  openForOrders: string;
  ordersPaused: string;
  pickupOnly: string;
  deliveryOnly: string;
  halal: string;
  allItems: string;
  categories: string;
  addNamed: (name: string, inBasket: number) => string;
  /** Said once, after a tap on a card's +. */
  addedNamed: (name: string, inBasket: number) => string;
  /** The product page. */
  shopOf: (name: string) => string;
  basketLabel: string;
  sizeLabel: string;
  /** "Needs 2 days. Earliest pickup Sat 17 Oct." Either half drops when the shop has nothing true to say for it. */
  productNotice: (days: number, dayText: string | null, pickup: boolean) => string | null;
  halalLine: string;
  askAboutThis: string;
  askSamples: string;
  askPrefill: (name: string) => string;
  addToBasket: (total: string) => string;
  wantMore: string;
  wantMoreBody: (name: string) => string;
  askQuestion: string;
  emptyTitle: string;
  emptyBody: (name: string) => string;
  askName: (name: string) => string;
  back: string;
  from: (price: string) => string;
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
  /** The basket bar's way to checkout, when the shop takes orders. */
  checkout: string;
  /** The Store preview's bar before anything is in the basket. */
  basketEmpty: string;
  /** The Store preview's Pay screen, for a shop with no QR or bank account yet. */
  noWayToPay: string;
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
  /** The order page's delivery line, after the day, for a rider delivery. */
  riderPaidSeparately: string;
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
  // The order page.
  bookmark: string;
  orderTitle: (number: number) => string;
  orderCode: string;
  orderProgress: string;
  steps: { placed: string; paid: string; ready: string; done: string };
  statusWaiting: string;
  statusChecking: (name: string) => string;
  statusPaid: (name: string) => string;
  statusReady: string;
  statusDone: string;
  statusCancelled: string;
  /** Cancelled after it was paid, and the money not yet marked back. */
  statusRefundDue: string;
  /** Said after a finished step's name, to a screen reader. */
  stepDone: string;
  statusRefunded: string;
  payTitle: (total: string) => string;
  payTo: (name: string) => string;
  scanOrTransfer: string;
  scanOnly: string;
  transferTo: string;
  /** No QR and no bank details set: the chat is the way to ask. */
  askHowToPay: (name: string) => string;
  qrLabel: (name: string) => string;
  saveQr: string;
  saveQrTitle: string;
  copy: string;
  uploadReceipt: string;
  uploadHint: string;
  uploadDifferent: string;
  uploading: string;
  receiptSent: string;
  checksIt: (name: string) => string;
  /** Owner decision 3: the owner marked the payment not received. */
  notReceived: (name: string) => string;
  receiptInvalid: string;
  receiptsOff: (name: string) => string;
  whatsappAbout: (name: string) => string;
  whatsappOrderText: (number: number, code: string) => string;
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
  shop: 'Shop',
  itemCount: (n) => `${n} ${n === 1 ? 'item' : 'items'}`,
  nextPickup: (day) => `next pickup ${day}`,
  nextDelivery: (day) => `next delivery ${day}`,
  barText: (items, total) => `${items} ${items === 1 ? 'item' : 'items'} · ${total}`,
  stillInBasket: 'Still in your basket',
  barPickup: (day) => `Pickup ${day}`,
  barDelivery: (day) => `Delivery ${day}`,
  factNextPickup: (day) => `Next pickup ${day}`,
  factNextDelivery: (day) => `Next delivery ${day}`,
  backTo: (name) => `Back to ${name}`,
  shareShop: 'Share the shop',
  linkCopied: 'Link copied',
  openForOrders: 'Open for orders',
  ordersPaused: 'Orders paused',
  pickupOnly: 'Pickup',
  deliveryOnly: 'Delivery',
  halal: 'Halal',
  allItems: 'All',
  categories: 'Categories',
  addNamed: (name, n) => (n > 0 ? `Add ${name}, ${n} in basket` : `Add ${name}`),
  addedNamed: (name, n) => `${name} added. ${n} in basket.`,
  shopOf: (name) => `${name}’s shop`,
  basketLabel: 'Basket',
  sizeLabel: 'Size',
  productNotice: (days, day, pickup) => {
    const need = days > 0 ? `Needs ${days} ${days === 1 ? 'day' : 'days'}.` : null;
    const earliest = day ? `Earliest ${pickup ? 'pickup' : 'delivery'} ${day}.` : null;
    return [need, earliest].filter(Boolean).join(' ') || null;
  },
  halalLine: 'Halal ingredients.',
  askAboutThis: 'Ask about this',
  askSamples: 'What’s in it? Is it OK for kids?',
  askPrefill: (name) => `I have a question about ${name}.`,
  addToBasket: (total) => `Add to basket · ${total}`,
  wantMore: 'Want something not listed?',
  wantMoreBody: (name) => `Ask ${name} about custom orders and bigger quantities.`,
  askQuestion: 'Ask a question',
  emptyTitle: 'New items are coming soon',
  emptyBody: (name) => `${name} is getting the shop ready. Ask what’s available today.`,
  askName: (name) => `Ask ${name}`,
  back: 'Back',
  from: (price) => `from ${price}`,
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
  checkout: 'Checkout',
  basketEmpty: 'Basket is empty',
  noWayToPay: 'No way to pay yet. Add a QR or your bank account.',
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
  riderPaidSeparately: 'Rider fee paid separately',
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
  bookmark: 'Bookmark this page',
  orderTitle: (number) => `Order #${number}`,
  orderCode: 'Order code',
  orderProgress: 'Order progress',
  steps: { placed: 'Placed', paid: 'Paid', ready: 'Ready', done: 'Done' },
  statusWaiting: 'Waiting for payment',
  statusChecking: (name) => `Receipt sent · ${name} is checking`,
  statusPaid: (name) => `Paid · ${name} is getting it ready`,
  statusReady: 'Ready',
  statusDone: 'Done',
  statusCancelled: 'Cancelled',
  statusRefundDue: 'Cancelled · refund due',
  stepDone: 'done',
  statusRefunded: 'Refunded',
  payTitle: (total) => `Pay ${total}`,
  payTo: (name) => `To ${name}, directly`,
  scanOrTransfer: 'Scan with any bank app, or transfer to',
  scanOnly: 'Scan with any bank app',
  transferTo: 'Transfer to',
  askHowToPay: (name) => `Ask ${name} how to pay, then upload your receipt here.`,
  qrLabel: (name) => `${name} DuitNow QR`,
  saveQr: 'Save the QR to your phone',
  saveQrTitle: 'Save QR',
  copy: 'Copy',
  uploadReceipt: 'Upload your receipt',
  uploadHint: 'A screenshot from your bank app',
  uploadDifferent: 'Upload a different receipt',
  uploading: 'Uploading…',
  receiptSent: 'sent',
  checksIt: (name) => `${name} checks it and confirms here`,
  notReceived: (name) => `${name} didn’t receive your payment. Pay again and upload the new receipt.`,
  receiptInvalid: 'Upload a photo or PDF of your receipt, up to 5 MB.',
  receiptsOff: (name) => `Receipts can’t be uploaded right now. Send yours to ${name} on WhatsApp instead.`,
  whatsappAbout: (name) => `WhatsApp ${name} about this order`,
  whatsappOrderText: (number, code) => `Hi, about my order #${number} (code ${code}).`,
};

const MS: ShopCopy = {
  visit: 'Lawati kedai',
  shop: 'Kedai',
  itemCount: (n) => `${n} barang`,
  nextPickup: (day) => `ambil seterusnya ${day}`,
  nextDelivery: (day) => `hantar seterusnya ${day}`,
  barText: (items, total) => `${items} barang · ${total}`,
  stillInBasket: 'Masih dalam bakul anda',
  barPickup: (day) => `Ambil ${day}`,
  barDelivery: (day) => `Hantar ${day}`,
  factNextPickup: (day) => `Ambil seterusnya ${day}`,
  factNextDelivery: (day) => `Hantar seterusnya ${day}`,
  backTo: (name) => `Kembali ke ${name}`,
  shareShop: 'Kongsi kedai',
  linkCopied: 'Pautan disalin',
  openForOrders: 'Buka untuk tempahan',
  ordersPaused: 'Tempahan ditangguhkan',
  pickupOnly: 'Ambil sendiri',
  deliveryOnly: 'Penghantaran',
  halal: 'Halal',
  allItems: 'Semua',
  categories: 'Kategori',
  addNamed: (name, n) => (n > 0 ? `Tambah ${name}, ${n} dalam bakul` : `Tambah ${name}`),
  addedNamed: (name, n) => `${name} ditambah. ${n} dalam bakul.`,
  shopOf: (name) => `Kedai ${name}`,
  basketLabel: 'Bakul',
  sizeLabel: 'Saiz',
  productNotice: (days, day, pickup) => {
    const need = days > 0 ? `Perlu ${days} hari.` : null;
    const earliest = day ? `Awal ${pickup ? 'ambil' : 'hantar'} ${day}.` : null;
    return [need, earliest].filter(Boolean).join(' ') || null;
  },
  halalLine: 'Bahan halal.',
  askAboutThis: 'Tanya tentang ini',
  askSamples: 'Apa kandungannya? Sesuai untuk kanak-kanak?',
  askPrefill: (name) => `Saya ada soalan tentang ${name}.`,
  addToBasket: (total) => `Masuk bakul · ${total}`,
  wantMore: 'Mahu sesuatu yang tiada di sini?',
  wantMoreBody: (name) => `Tanya ${name} tentang tempahan khas dan kuantiti lebih besar.`,
  askQuestion: 'Tanya soalan',
  emptyTitle: 'Barang baharu akan datang',
  emptyBody: (name) => `${name} sedang menyediakan kedai. Tanya apa yang ada hari ini.`,
  askName: (name) => `Tanya ${name}`,
  back: 'Kembali',
  from: (price) => `dari ${price}`,
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
  checkout: 'Daftar keluar',
  basketEmpty: 'Bakul kosong',
  noWayToPay: 'Belum ada cara untuk bayar. Tambah QR atau akaun bank anda.',
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
  riderPaidSeparately: 'Caj rider dibayar berasingan',
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
  bookmark: 'Tandakan halaman ini',
  orderTitle: (number) => `Tempahan #${number}`,
  orderCode: 'Kod tempahan',
  orderProgress: 'Kemajuan tempahan',
  steps: { placed: 'Dibuat', paid: 'Dibayar', ready: 'Sedia', done: 'Selesai' },
  statusWaiting: 'Menunggu bayaran',
  statusChecking: (name) => `Resit dihantar · ${name} sedang menyemak`,
  statusPaid: (name) => `Dibayar · ${name} sedang menyediakannya`,
  statusReady: 'Sedia',
  statusDone: 'Selesai',
  statusCancelled: 'Dibatalkan',
  statusRefundDue: 'Dibatalkan · wang akan dipulangkan',
  stepDone: 'selesai',
  statusRefunded: 'Wang dipulangkan',
  payTitle: (total) => `Bayar ${total}`,
  payTo: (name) => `Terus kepada ${name}`,
  scanOrTransfer: 'Imbas dengan mana-mana aplikasi bank, atau pindahkan ke',
  scanOnly: 'Imbas dengan mana-mana aplikasi bank',
  transferTo: 'Pindahkan ke',
  askHowToPay: (name) => `Tanya ${name} cara membayar, kemudian muat naik resit anda di sini.`,
  qrLabel: (name) => `DuitNow QR ${name}`,
  saveQr: 'Simpan QR ke telefon anda',
  saveQrTitle: 'Simpan QR',
  copy: 'Salin',
  uploadReceipt: 'Muat naik resit anda',
  uploadHint: 'Tangkapan skrin dari aplikasi bank anda',
  uploadDifferent: 'Muat naik resit lain',
  uploading: 'Sedang dimuat naik…',
  receiptSent: 'dihantar',
  checksIt: (name) => `${name} akan menyemaknya dan mengesahkan di sini`,
  notReceived: (name) => `${name} tidak menerima bayaran anda. Bayar semula dan muat naik resit yang baharu.`,
  receiptInvalid: 'Muat naik foto atau PDF resit anda, sehingga 5 MB.',
  receiptsOff: (name) => `Resit tidak dapat dimuat naik buat masa ini. Hantar resit anda kepada ${name} di WhatsApp.`,
  whatsappAbout: (name) => `WhatsApp ${name} tentang tempahan ini`,
  whatsappOrderText: (number, code) => `Hai, tentang tempahan saya #${number} (kod ${code}).`,
};

export function shopCopy(language: string): ShopCopy {
  return language === 'ms' ? MS : EN;
}
