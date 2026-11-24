/** The report form's own words, in the page's language. Anything but 'ms' reads English. */
export interface ReportCopy {
  heading: (displayName: string) => string;
  lede: string;
  details: string;
  /** The textarea's placeholder. */
  detailsHint: string;
  send: string;
  /** The title once it is sent, and the line under it. */
  thanks: string;
  done: string;
  /** "Back to {name}": the nav button and the way out once it is sent. */
  back: (displayName: string) => string;
  tooMany: string;
  /** Any other failure: the API's own message is English, so the form never shows it. */
  failed: string;
}

const EN: ReportCopy = {
  heading: (displayName) => `Report ${displayName}`,
  lede: "Tell the Curios team what's wrong. The owner isn't told who reported it.",
  details: 'More details (optional)',
  detailsHint: 'What did you see?',
  send: 'Send report',
  thanks: 'Thanks',
  done: 'The Curios team will look at it.',
  back: (displayName) => `Back to ${displayName}`,
  tooMany: 'Too many reports from here. Try again later.',
  failed: 'Something went wrong. Try again.',
};

const MS: ReportCopy = {
  heading: (displayName) => `Laporkan ${displayName}`,
  lede: 'Beritahu pasukan Curios apa yang salah. Pemilik tidak diberitahu siapa yang melaporkan.',
  details: 'Butiran lanjut (pilihan)',
  detailsHint: 'Apa yang anda lihat?',
  send: 'Hantar laporan',
  thanks: 'Terima kasih',
  done: 'Pasukan Curios akan menyemaknya.',
  back: (displayName) => `Kembali ke ${displayName}`,
  tooMany: 'Terlalu banyak laporan dari sini. Cuba lagi nanti.',
  failed: 'Ada masalah. Cuba lagi.',
};

export function reportCopy(language: string | undefined): ReportCopy {
  return language === 'ms' ? MS : EN;
}
