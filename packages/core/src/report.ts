/** Why a visitor reports a page. The keys match the database enum `ReportReason`. */
export type ReportReasonKey = 'SCAM' | 'IMPERSONATION' | 'WRONG_PRICES' | 'OFFENSIVE' | 'OTHER';

/** The words the report form and the admin screen use, in both languages. */
export const REPORT_REASONS: Record<ReportReasonKey, { en: string; ms: string }> = {
  SCAM: { en: 'Looks like a scam', ms: 'Nampak macam penipuan' },
  IMPERSONATION: { en: 'Pretending to be someone', ms: 'Menyamar sebagai orang lain' },
  WRONG_PRICES: { en: 'Wrong prices or details', ms: 'Harga atau butiran salah' },
  OFFENSIVE: { en: 'Offensive', ms: 'Menyinggung' },
  OTHER: { en: 'Something else', ms: 'Lain-lain' },
};

/** A page with more open reports than this is flagged for a look. Nothing is hidden automatically. */
export const FLAG_OVER = 5;

export function isFlagged(openReports: number): boolean {
  return openReports > FLAG_OVER;
}

/** The longest note a visitor can add to a report. */
export const REPORT_DETAILS_MAX = 500;
