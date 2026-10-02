/**
 * Concurrency lives here, in one place, not scattered across worker files.
 * The queue name and payload shape live in @curios/core, because the API needs
 * them too and the two apps must never import each other.
 */
export const QUEUE_CONCURRENCY = { ingest: 2, mail: 5, billing: 1, group: 1 } as const;
