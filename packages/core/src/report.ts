/**
 * Why a visitor reports a page, and the words the report form and the admin screen use, in both
 * languages. The one list: its keys are the reasons the API takes, and the API checks at compile
 * time that they are the database enum `ReportReason`.
 */
export const REPORT_REASONS = {
  SCAM: { en: 'Looks like a scam', ms: 'Nampak macam penipuan' },
  IMPERSONATION: { en: 'Pretending to be someone', ms: 'Menyamar sebagai orang lain' },
  WRONG_PRICES: { en: 'Wrong prices or details', ms: 'Harga atau butiran salah' },
  OFFENSIVE: { en: 'Offensive', ms: 'Menyinggung' },
  OTHER: { en: 'Something else', ms: 'Lain-lain' },
} as const satisfies Record<string, { en: string; ms: string }>;

export type ReportReasonKey = keyof typeof REPORT_REASONS;

/** The keys as a non-empty tuple, the shape a zod enum takes. */
export const REPORT_REASON_KEYS = Object.keys(REPORT_REASONS) as [ReportReasonKey, ...ReportReasonKey[]];

/** A page with more open reports than this is flagged for a look. Nothing is hidden automatically. */
export const FLAG_OVER = 5;

export function isFlagged(openReports: number): boolean {
  return openReports > FLAG_OVER;
}

/** The longest note a visitor can add to a report. */
export const REPORT_DETAILS_MAX = 500;
