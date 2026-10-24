/**
 * The shop's words, in the page's language. Two languages, like the landing
 * copy: a page whose language is anything else reads English.
 */
/** What the copy needs of a digital item to describe it. */
export interface DigitalLook {
  delivery: 'FILES' | 'LINK' | 'CODES' | 'SESSION' | null;
  format: { kinds: string[]; count: number } | null;
  minutes: number | null;
  place: 'ONLINE' | 'IN_PERSON' | null;
}

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
  /** The Ask tab: the page's opening line, the label over each reply, and the product card's two buttons. */
  askHello: (name: string) => string;
  askLabel: (name: string) => string;
  cardAdd: string;
  cardIn: string;
  cardOpen: (name: string) => string;
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
  // How you'll pay (Public board, checkout): the choices, their lists, the email, the button and the note.
  howYoullPay: string;
  onlineBanking: string;
  onlineBankingSub: string;
  eWallet: string;
  card: string;
  cardSub: string;
  duitnowQr: string;
  duitnowQrSub: (name: string) => string;
  /** The one choice when the shop has no CHIP: its QR or bank account. */
  qrOrBank: string;
  qrOrBankSub: (name: string) => string;
  yourBank: string;
  yourWallet: string;
  /** Owner's answer 2: asked only for an online method. */
  email: string;
  forReceipt: string;
  payWith: (total: string, where: string) => string;
  payByCard: (total: string) => string;
  noteBank: string;
  noteWallet: string;
  noteCard: string;
  chipNote: (name: string) => string;
  /** Paying online failed after the order was placed: it waits for the QR instead. */
  onlineUnavailable: string;
  /** The same, for a shop with no QR or bank account: its WhatsApp is the way. */
  onlineUnavailableWhatsApp: (name: string) => string;
  /** A shop with no QR, bank account or CHIP: its WhatsApp is how to pay. */
  payOnWhatsApp: (name: string) => string;
  /** The API's limit on starting a payment answered 429, said beside a way to try again. */
  payTooMany: string;
  /** The same on the placed screen, which has no retry: the order page does. */
  payTooManyLater: string;
  /** The order page's retry (DEVIATIONS 178): online choices only, once a payment failed or was tried too often. */
  tryPayAgain: string;
  /** A shop whose only way to pay is online, when online is not available. */
  cantPayOnline: (name: string) => string;
  /** Under a wait the page cannot end: the QR is offered, but not twice. */
  dontPayAgain: (name: string) => string;
  /** CHIP's own words for how it was paid, in this language ("Visa card ending 4242"). */
  methodLabel: (label: string) => string;
  /** The board's Paid row on the order page. */
  paidBy: (total: string, how: string) => string;
  paidWhen: (when: string, ref: string) => string;
  /** "15 Oct, 3:42pm", in Malaysia. */
  paidTime: (iso: string) => string;
  checkingPayment: string;
  stillWaiting: string;
  onlineFailed: string;
  // The placed screen after paying online.
  paidPlaced: string;
  paidPlacedSub: (total: string, name: string) => string;
  seeOrder: string;
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
  steps: { placed: string; paid: string; ready: string; done: string; sent: string };
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
  // Digital items (the Public board's digital frames).
  /** The tag on a digital item's card and page, and its own category chip. */
  digital: string;
  soldOut: string;
  pickATime: string;
  seatsLeft: (n: number) => string;
  full: string;
  /** "Sat 7 Nov, 8:00pm", in Malaysia. */
  sessionTime: (iso: string) => string;
  /** The product page's two facts for a digital item. */
  getLine: (delivery: 'FILES' | 'LINK' | 'CODES' | 'SESSION') => string;
  fmtLine: (item: DigitalLook) => string;
  /** A digital line's small print in the basket and at checkout. */
  digitalSub: (item: DigitalLook, time: string | null) => string;
  byEmailRightAfter: string;
  byEmailBody: string;
  mixedLine: string;
  /** "Email  where we send your files". */
  emailFor: (what: 'files' | 'link' | 'codes' | 'session' | 'mixed') => string;
  digitalItems: string;
  byEmail: string;
  pickTimeFirst: string;
  /** The placed screen's small line under a digital order. */
  digitalPlacedNote: (paid: boolean, email: string) => string;
  /** The placed screen, for an unpaid order holding a code or a class seat. */
  holdNote: string;
  /** The order page's digital part (Public board, `order`). */
  statusSent: string;
  statusPaidDigital: string;
  /** What a set of digital kinds is called: "files", "link", "code", "class details", or "downloads and access". */
  digWhat: (kinds: string[]) => string;
  paidPlacedDigital: string;
  paidPlacedDigitalSub: (total: string, what: string) => string;
  getYour: (what: string) => string;
  dgLockTitle: (what: string) => string;
  dgLockCheck: (name: string) => string;
  dgLockPay: string;
  dgTitle: (onlyFiles: boolean) => string;
  alsoSentTo: (email: string) => string;
  download: string;
  downloadsLeft: (n: number) => string;
  usedUp: string;
  expired: string;
  linksUntil: (date: string, name: string) => string;
  linksSomeDead: (name: string) => string;
  /** A short date, "14 Nov", in Malaysia. */
  shortDate: (iso: string) => string;
  openLink: string;
  linkPrivate: string;
  copyShort: string;
  codeNote: (name: string) => string;
  minutesLong: (n: number) => string;
  online: string;
  inPerson: (where: string | null) => string;
  joinClass: string;
  addToCalendar: string;
  sessionNote: string;
  sendingNow: string;
  pausedDownloads: (name: string) => string;
  /** The API's refusals for digital lines, in this language. */
  digitalError: (code: string) => string | null;
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

/** Malaysia is UTC+8 all year: the time read off this Date's UTC fields is Malaysia's. */
const malaysiaTime = (iso: string) => new Date(new Date(iso).getTime() + 8 * 3_600_000);
const pad = (n: number) => String(n).padStart(2, '0');

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
  askHello: (name) => `Hi! I’m ${name}’s page. Ask me about what’s on offer, prices or how to order.`,
  askLabel: (name) => `${name}’s page`,
  cardAdd: 'Add to basket',
  cardIn: 'In your basket',
  cardOpen: (name) => `Open ${name}`,
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
  payNote: (name) => `You pay ${name} directly on the next step, then upload your receipt.`,
  howYoullPay: 'How you’ll pay',
  onlineBanking: 'Online banking',
  onlineBankingSub: 'FPX · Maybank2u, CIMB Clicks, RHB and more',
  eWallet: 'E-wallet',
  card: 'Card',
  cardSub: 'Debit or credit card',
  duitnowQr: 'DuitNow QR',
  duitnowQrSub: (name) => `Scan ${name}’s QR, then upload your receipt`,
  qrOrBank: 'DuitNow QR or bank transfer',
  qrOrBankSub: (name) => `Pay ${name} directly, then upload your receipt`,
  yourBank: 'Your bank',
  yourWallet: 'Your e-wallet',
  email: 'Email',
  forReceipt: 'for your receipt',
  payWith: (total, where) => `Pay ${total} with ${where}`,
  payByCard: (total) => `Pay ${total} by card`,
  noteBank: 'You’ll go straight to your bank to approve it, then come back here.',
  noteWallet: 'You’ll go straight to your e-wallet to approve it, then come back here.',
  noteCard: 'You’ll enter your card on a secure page, then come straight back here.',
  chipNote: (name) => `Payments are processed by CHIP, and the money goes to ${name}’s own account.`,
  onlineUnavailable: 'Online payment isn’t available right now. Pay by QR or bank transfer instead.',
  onlineUnavailableWhatsApp: (name) => `Online payment isn’t available right now. WhatsApp ${name} to pay.`,
  payOnWhatsApp: (name) => `WhatsApp ${name} to pay.`,
  payTooMany: 'Too many tries. Wait a moment and try again.',
  payTooManyLater: 'Too many tries just now. Open your order in a moment to try again.',
  tryPayAgain: 'Try paying again',
  cantPayOnline: (name) => `${name} can’t take payment online right now. Keep this page — it updates once you’ve paid.`,
  dontPayAgain: (name) => `If you already paid online, don’t pay again — WhatsApp ${name}.`,
  methodLabel: (label) => label,
  paidBy: (total, how) => `Paid ${total} by ${how}`,
  paidWhen: (when, ref) => `${when} · Ref ${ref}`,
  paidTime: (iso) => {
    const at = malaysiaTime(iso);
    const hour = at.getUTCHours() % 12 || 12;
    return `${at.getUTCDate()} ${EN_MONTH[at.getUTCMonth()]}, ${hour}:${pad(at.getUTCMinutes())}${at.getUTCHours() < 12 ? 'am' : 'pm'}`;
  },
  checkingPayment: 'Checking your payment…',
  stillWaiting: 'We’re still waiting for the bank. This page updates once it’s confirmed.',
  onlineFailed: 'Your online payment didn’t go through.',
  paidPlaced: 'Paid. Order placed',
  paidPlacedSub: (total, name) => `${total} paid. ${name} has your order and will get it ready.`,
  seeOrder: 'See your order',
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
  steps: { placed: 'Placed', paid: 'Paid', ready: 'Ready', done: 'Done', sent: 'Sent' },
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
  digital: 'Digital',
  soldOut: 'Sold out',
  pickATime: 'Pick a time',
  seatsLeft: (n) => `${n} ${n === 1 ? 'seat' : 'seats'} left`,
  full: 'Full',
  sessionTime: (iso) => {
    const at = malaysiaTime(iso);
    const hour = at.getUTCHours() % 12 || 12;
    return `${EN_DAY[at.getUTCDay()]} ${at.getUTCDate()} ${EN_MONTH[at.getUTCMonth()]}, ${hour}:${pad(at.getUTCMinutes())}${at.getUTCHours() < 12 ? 'am' : 'pm'}`;
  },
  getLine: (delivery) =>
    ({
      FILES: 'Sent by email right after you pay, and kept on your order page.',
      LINK: 'Your private link comes by email right after you pay.',
      CODES: 'Your own code comes by email right after you pay.',
      SESSION: 'The class details come by email right after you pay.',
    })[delivery],
  fmtLine: (item) => {
    if (item.delivery === 'FILES') return item.format ? `${item.format.kinds.join(', ')}, ${item.format.count} ${item.format.count === 1 ? 'file' : 'files'}. Download up to 5 times.` : 'Download up to 5 times.';
    if (item.delivery === 'LINK') return 'Open it on any phone or laptop, as often as you like.';
    if (item.delivery === 'CODES') return 'One code for each one you buy.';
    const how = item.place === 'IN_PERSON' ? 'in person' : 'online';
    return `${item.minutes ? `${item.minutes} ${item.minutes === 1 ? 'minute' : 'minutes'}` : 'Live'}, ${how}. Seats are limited.`;
  },
  digitalSub: (item, time) => {
    if (item.delivery === 'FILES') return item.format ? `${item.format.kinds.join(', ')} · ${item.format.count} ${item.format.count === 1 ? 'file' : 'files'}` : 'Files';
    if (item.delivery === 'LINK') return 'Private link';
    if (item.delivery === 'CODES') return 'Your own code';
    return [time, item.minutes ? `${item.minutes} ${item.minutes === 1 ? 'minute' : 'minutes'}` : null].filter(Boolean).join(' · ');
  },
  byEmailRightAfter: 'By email, right after you pay',
  byEmailBody: 'Also on your order page. Nothing to pick up, no delivery fee.',
  mixedLine: 'The digital items in your order come by email. This is for the rest.',
  emailFor: (what) => `where we send your ${{ files: 'files', link: 'link', codes: 'code', session: 'class details', mixed: 'downloads and access' }[what]}`,
  digitalItems: 'Digital items',
  byEmail: 'By email',
  pickTimeFirst: 'Pick a time for this class.',
  digitalPlacedNote: (paid, email) => (paid ? `Sent to ${email}. It’s on your order page too.` : 'Your items unlock as soon as your payment is confirmed.'),
  holdNote: 'Unpaid orders are released after 24 hours.',
  statusSent: 'Paid · Sent to your email',
  statusPaidDigital: 'Paid',
  digWhat: (kinds) => (kinds.length === 1 ? ({ FILES: 'files', LINK: 'link', CODES: 'code', SESSION: 'class details' } as Record<string, string>)[kinds[0]!] ?? 'downloads and access' : 'downloads and access'),
  paidPlacedDigital: 'Paid. It’s on its way to your email',
  paidPlacedDigitalSub: (total, what) => `${total} paid. Your ${what} are ready now.`,
  getYour: (what) => `Get your ${what}`,
  dgLockTitle: (what) => `Your ${what} unlock once you’ve paid`,
  dgLockCheck: (name) => `${name} is checking your receipt. You’ll get an email the moment it’s confirmed.`,
  dgLockPay: 'Pay above, and they come straight to this page and your email.',
  dgTitle: (onlyFiles) => (onlyFiles ? 'Your downloads' : 'Your downloads and access'),
  alsoSentTo: (email) => `Also sent to ${email}`,
  download: 'Download',
  downloadsLeft: (n) => (n === 1 ? '1 download left' : `${n} downloads left`),
  usedUp: '0 left',
  expired: 'Expired',
  linksUntil: (date, name) => `Links work until ${date}. Lost them? ${name} can send new ones.`,
  linksSomeDead: (name) => `Some links are used up or have expired. Ask ${name} for new ones.`,
  shortDate: (iso) => {
    const at = malaysiaTime(iso);
    return `${at.getUTCDate()} ${EN_MONTH[at.getUTCMonth()]}`;
  },
  openLink: 'Open your link',
  linkPrivate: 'This link is just for you. Please don’t share it.',
  copyShort: 'Copy',
  codeNote: (name) => `Your own code from ${name}. Keep it safe.`,
  minutesLong: (n) => `${n} ${n === 1 ? 'minute' : 'minutes'}`,
  online: 'Online',
  inPerson: (where) => (where ? `In person, ${where}` : 'In person'),
  joinClass: 'Join the class',
  addToCalendar: 'Add to calendar',
  sessionNote: 'We’ll remind you by email the day before.',
  sendingNow: 'Being sent to your email now.',
  pausedDownloads: (name) => `${name}’s page is unavailable right now, so downloads and links are paused.`,
  digitalError: (code) =>
    ({
      SOLD_OUT: 'Something in your basket is sold out. Remove it and try again.',
      TIME_FULL: 'That class time is full or has passed. Pick another time.',
      TIME_REQUIRED: 'Pick a time for your class first.',
      EMAIL_REQUIRED: 'Add the email where we should send your digital items.',
    })[code] ?? null,
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
  askHello: (name) => `Hai! Saya halaman ${name}. Tanya saya tentang apa yang ditawarkan, harga atau cara menempah.`,
  askLabel: (name) => `Halaman ${name}`,
  cardAdd: 'Masuk bakul',
  cardIn: 'Dalam bakul anda',
  cardOpen: (name) => `Buka ${name}`,
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
  payNote: (name) => `Anda bayar terus kepada ${name} pada langkah seterusnya, kemudian muat naik resit anda.`,
  howYoullPay: 'Cara anda bayar',
  onlineBanking: 'Perbankan dalam talian',
  onlineBankingSub: 'FPX · Maybank2u, CIMB Clicks, RHB dan lain-lain',
  eWallet: 'E-dompet',
  card: 'Kad',
  cardSub: 'Kad debit atau kredit',
  duitnowQr: 'DuitNow QR',
  duitnowQrSub: (name) => `Imbas QR ${name}, kemudian muat naik resit anda`,
  qrOrBank: 'DuitNow QR atau pindahan bank',
  qrOrBankSub: (name) => `Bayar terus kepada ${name}, kemudian muat naik resit anda`,
  yourBank: 'Bank anda',
  yourWallet: 'E-dompet anda',
  email: 'E-mel',
  forReceipt: 'untuk resit anda',
  payWith: (total, where) => `Bayar ${total} dengan ${where}`,
  payByCard: (total) => `Bayar ${total} dengan kad`,
  noteBank: 'Anda akan terus ke bank anda untuk meluluskannya, kemudian kembali ke sini.',
  noteWallet: 'Anda akan terus ke e-dompet anda untuk meluluskannya, kemudian kembali ke sini.',
  noteCard: 'Anda akan masukkan kad anda di halaman yang selamat, kemudian terus kembali ke sini.',
  chipNote: (name) => `Bayaran diproses oleh CHIP, dan wang terus masuk ke akaun ${name} sendiri.`,
  onlineUnavailable: 'Bayaran dalam talian tidak tersedia buat masa ini. Bayar melalui QR atau pindahan bank.',
  onlineUnavailableWhatsApp: (name) => `Bayaran dalam talian tidak tersedia buat masa ini. WhatsApp ${name} untuk bayar.`,
  payOnWhatsApp: (name) => `WhatsApp ${name} untuk bayar.`,
  payTooMany: 'Terlalu banyak cubaan. Tunggu sebentar dan cuba lagi.',
  payTooManyLater: 'Terlalu banyak cubaan tadi. Buka tempahan anda sebentar lagi untuk cuba semula.',
  tryPayAgain: 'Cuba bayar sekali lagi',
  cantPayOnline: (name) => `${name} tidak dapat menerima bayaran dalam talian buat masa ini. Simpan halaman ini — ia dikemas kini sebaik sahaja anda membayar.`,
  dontPayAgain: (name) => `Jika anda sudah membayar dalam talian, jangan bayar lagi — WhatsApp ${name}.`,
  methodLabel: (label) =>
    label.replace(/^(\w+) card ending (\d{4})$/, 'kad $1 berakhir $2').replace(/^(\w+) card$/, 'kad $1'),
  paidBy: (total, how) => `Dibayar ${total} melalui ${how}`,
  paidWhen: (when, ref) => `${when} · Ruj ${ref}`,
  paidTime: (iso) => {
    const at = malaysiaTime(iso);
    return `${at.getUTCDate()} ${MS_MONTH[at.getUTCMonth()]}, ${at.getUTCHours()}:${pad(at.getUTCMinutes())}`;
  },
  checkingPayment: 'Menyemak bayaran anda…',
  stillWaiting: 'Kami masih menunggu bank. Halaman ini dikemas kini sebaik sahaja ia disahkan.',
  onlineFailed: 'Bayaran dalam talian anda tidak berjaya.',
  paidPlaced: 'Dibayar. Tempahan dibuat',
  paidPlacedSub: (total, name) => `${total} dibayar. ${name} sudah menerima tempahan anda dan akan menyediakannya.`,
  seeOrder: 'Lihat tempahan anda',
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
  steps: { placed: 'Dibuat', paid: 'Dibayar', ready: 'Sedia', done: 'Selesai', sent: 'Dihantar' },
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
  digital: 'Digital',
  soldOut: 'Habis dijual',
  pickATime: 'Pilih masa',
  seatsLeft: (n) => `${n} tempat lagi`,
  full: 'Penuh',
  sessionTime: (iso) => {
    const at = malaysiaTime(iso);
    return `${MS_DAY[at.getUTCDay()]} ${at.getUTCDate()} ${MS_MONTH[at.getUTCMonth()]}, ${at.getUTCHours()}:${pad(at.getUTCMinutes())}`;
  },
  getLine: (delivery) =>
    ({
      FILES: 'Dihantar melalui e-mel sebaik anda membayar, dan disimpan di halaman tempahan anda.',
      LINK: 'Pautan peribadi anda datang melalui e-mel sebaik anda membayar.',
      CODES: 'Kod anda sendiri datang melalui e-mel sebaik anda membayar.',
      SESSION: 'Butiran kelas datang melalui e-mel sebaik anda membayar.',
    })[delivery],
  fmtLine: (item) => {
    if (item.delivery === 'FILES') return item.format ? `${item.format.kinds.join(', ')}, ${item.format.count} fail. Muat turun sehingga 5 kali.` : 'Muat turun sehingga 5 kali.';
    if (item.delivery === 'LINK') return 'Buka di mana-mana telefon atau komputer riba, sebanyak mana anda suka.';
    if (item.delivery === 'CODES') return 'Satu kod untuk setiap satu yang anda beli.';
    const how = item.place === 'IN_PERSON' ? 'bersemuka' : 'dalam talian';
    return `${item.minutes ? `${item.minutes} minit` : 'Secara langsung'}, ${how}. Tempat terhad.`;
  },
  digitalSub: (item, time) => {
    if (item.delivery === 'FILES') return item.format ? `${item.format.kinds.join(', ')} · ${item.format.count} fail` : 'Fail';
    if (item.delivery === 'LINK') return 'Pautan peribadi';
    if (item.delivery === 'CODES') return 'Kod anda sendiri';
    return [time, item.minutes ? `${item.minutes} minit` : null].filter(Boolean).join(' · ');
  },
  byEmailRightAfter: 'Melalui e-mel, sebaik anda membayar',
  byEmailBody: 'Juga di halaman tempahan anda. Tiada apa untuk diambil, tiada caj penghantaran.',
  mixedLine: 'Barang digital dalam tempahan anda datang melalui e-mel. Ini untuk yang lain.',
  emailFor: (what) => `ke mana kami hantar ${{ files: 'fail', link: 'pautan', codes: 'kod', session: 'butiran kelas', mixed: 'muat turun dan akses' }[what]} anda`,
  digitalItems: 'Barang digital',
  byEmail: 'Melalui e-mel',
  pickTimeFirst: 'Pilih masa untuk kelas ini.',
  digitalPlacedNote: (paid, email) => (paid ? `Dihantar ke ${email}. Ia juga ada di halaman tempahan anda.` : 'Barang anda dibuka sebaik bayaran anda disahkan.'),
  holdNote: 'Tempahan yang belum dibayar dilepaskan selepas 24 jam.',
  statusSent: 'Dibayar · Dihantar ke e-mel anda',
  statusPaidDigital: 'Dibayar',
  digWhat: (kinds) => (kinds.length === 1 ? ({ FILES: 'fail', LINK: 'pautan', CODES: 'kod', SESSION: 'butiran kelas' } as Record<string, string>)[kinds[0]!] ?? 'muat turun dan akses' : 'muat turun dan akses'),
  paidPlacedDigital: 'Dibayar. Dalam perjalanan ke e-mel anda',
  paidPlacedDigitalSub: (total, what) => `${total} dibayar. ${what.charAt(0).toUpperCase()}${what.slice(1)} anda sudah sedia.`,
  getYour: (what) => `Dapatkan ${what} anda`,
  dgLockTitle: (what) => `${what.charAt(0).toUpperCase()}${what.slice(1)} anda dibuka sebaik anda membayar`,
  dgLockCheck: (name) => `${name} sedang menyemak resit anda. Anda akan terima e-mel sebaik ia disahkan.`,
  dgLockPay: 'Bayar di atas, dan ia terus datang ke halaman ini dan e-mel anda.',
  dgTitle: (onlyFiles) => (onlyFiles ? 'Muat turun anda' : 'Muat turun dan akses anda'),
  alsoSentTo: (email) => `Juga dihantar ke ${email}`,
  download: 'Muat turun',
  downloadsLeft: (n) => `${n} muat turun lagi`,
  usedUp: '0 lagi',
  expired: 'Tamat tempoh',
  linksUntil: (date, name) => `Pautan berfungsi sehingga ${date}. Hilang? ${name} boleh hantar yang baharu.`,
  linksSomeDead: (name) => `Ada pautan yang sudah habis digunakan atau tamat tempoh. Minta yang baharu daripada ${name}.`,
  shortDate: (iso) => {
    const at = malaysiaTime(iso);
    return `${at.getUTCDate()} ${MS_MONTH[at.getUTCMonth()]}`;
  },
  openLink: 'Buka pautan anda',
  linkPrivate: 'Pautan ini untuk anda sahaja. Jangan kongsikannya.',
  copyShort: 'Salin',
  codeNote: (name) => `Kod anda sendiri daripada ${name}. Simpan baik-baik.`,
  minutesLong: (n) => `${n} minit`,
  online: 'Dalam talian',
  inPerson: (where) => (where ? `Bersemuka, ${where}` : 'Bersemuka'),
  joinClass: 'Sertai kelas',
  addToCalendar: 'Tambah ke kalendar',
  sessionNote: 'Kami akan ingatkan anda melalui e-mel sehari sebelum.',
  sendingNow: 'Sedang dihantar ke e-mel anda.',
  pausedDownloads: (name) => `Halaman ${name} tidak tersedia buat masa ini, jadi muat turun dan pautan dijeda.`,
  digitalError: (code) =>
    ({
      SOLD_OUT: 'Ada barang dalam bakul anda yang sudah habis dijual. Buangnya dan cuba lagi.',
      TIME_FULL: 'Masa kelas itu sudah penuh atau sudah berlalu. Pilih masa lain.',
      TIME_REQUIRED: 'Pilih masa untuk kelas anda dahulu.',
      EMAIL_REQUIRED: 'Masukkan e-mel ke mana kami patut hantar barang digital anda.',
    })[code] ?? null,
};

export function shopCopy(language: string): ShopCopy {
  return language === 'ms' ? MS : EN;
}
