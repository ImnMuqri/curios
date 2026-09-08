export { normalizeClaim } from './normalize.js';
export { FACT_CATEGORIES, INGEST_QUEUE, MAIL_QUEUE } from './types.js';
export type {
  FactCategory,
  SourceDocument,
  ParsedFact,
  IngestJobData,
  MailJobData,
} from './types.js';
export { parseFactBlocks } from './parse-facts.js';
export type { ParseResult } from './parse-facts.js';
export { HANDLE_MIN, HANDLE_MAX, handleSkeleton, checkHandle } from './handle.js';
export type { HandleCheck } from './handle.js';
export { hashSessionValue } from './session-hash.js';
export { SESSION_ABSOLUTE_TTL_MS, SESSION_IDLE_TTL_MS } from './session.js';
export { SESSION_COOKIE } from './cookie.js';
export { isAddressLiteral, isBlockedAddress } from './address.js';
export {
  allowsPrivateAddresses,
  BlockedAddressError,
  inspectSourceUrl,
  requirePublicAddresses,
} from './source-url.js';
export type { ResolvedAddress, SourceUrlVerdict } from './source-url.js';
export { normalizeMalaysianPhone } from './phone.js';
export { MIN_VISITOR_TURNS, qualifies } from './qualify.js';
