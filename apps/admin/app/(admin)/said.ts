import { ApiError } from '../../lib/api.js';

/** Codes whose sentence is ours to say, whatever the API's message (a 5xx may arrive as the generic one). */
const OURS: Record<string, string> = {
  QUEUE_UNAVAILABLE: "Couldn't reach the reading queue. Nothing was changed. Try again.",
};

/** The API's words read fine as they are; anything else (a dropped connection) gets ours. */
export const said = (e: unknown): Error =>
  e instanceof ApiError ? (OURS[e.code] ? new ApiError(e.status, e.code, OURS[e.code]!, e.fields) : e) : new Error('Something failed. Try again.');
