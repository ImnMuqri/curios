/** The report form's own words, in the page's language. Anything but 'ms' reads English. */
export interface ReportCopy {
  heading: (displayName: string) => string;
  lede: string;
  details: string;
  send: string;
  done: string;
  tooMany: string;
  /** Any other failure: the API's own message is English, so the form never shows it. */
  failed: string;
}

const EN: ReportCopy = {
  heading: (displayName) => `Report ${displayName}`,
  lede: "Tell the Curios team what's wrong. The owner isn't told who reported it.",
  details: 'More details (optional)',
  send: 'Send report',
  done: 'Thanks. The Curios team will look at it.',
  tooMany: 'Too many reports from here. Try again later.',
  failed: 'Something went wrong. Try again.',
};

const MS: ReportCopy = {
  heading: (displayName) => `Laporkan ${displayName}`,
  lede: 'Beritahu pasukan Curios apa yang salah. Pemilik tidak diberitahu siapa yang melaporkan.',
  details: 'Butiran lanjut (pilihan)',
  send: 'Hantar laporan',
  done: 'Terima kasih. Pasukan Curios akan menyemaknya.',
  tooMany: 'Terlalu banyak laporan dari sini. Cuba lagi nanti.',
  failed: 'Ada masalah. Cuba lagi.',
};

export function reportCopy(language: string | undefined): ReportCopy {
  return language === 'ms' ? MS : EN;
}
