import { ApiError } from '../../lib/api.js';

/** The API's words read fine as they are; anything else (a dropped connection) gets ours. */
export const said = (e: unknown): Error => (e instanceof ApiError ? e : new Error('Something failed. Try again.'));
