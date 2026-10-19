import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';

/** The same settings the API uploads with (apps/api/src/modules/pages/storage.ts). */
const STORAGE_ENV = ['STORAGE_ENDPOINT', 'STORAGE_BUCKET', 'STORAGE_ACCESS_KEY_ID', 'STORAGE_SECRET_ACCESS_KEY', 'STORAGE_PUBLIC_URL'] as const;

/**
 * Whether storage is switched off in this process: outside production, and
 * only when none of its settings is set -- the API's rule, so the two agree
 * about whether there is anything stored to remove. A partial set is a
 * mistake and falls through to the check that names the missing setting.
 */
export function storageDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV === 'production') return false;
  return STORAGE_ENV.every((name) => !env[name]);
}

/** Deletes these objects; resolves with the keys it could not delete, never rejects. */
export type RemoveObjects = (keys: string[]) => Promise<{ failed: string[] }>;

function required(env: NodeJS.ProcessEnv, name: (typeof STORAGE_ENV)[number]): string {
  const value = env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/**
 * Removes stored files (R2 or S3, through the SDK the API uses), or null when
 * storage is off. One DeleteObject per key, the call the API removes a
 * receipt with; a key that fails is reported, not thrown, so one bad file
 * cannot keep the rest. Each delete is abandoned after `timeoutMs`, so one
 * hung request cannot stall the night's sweep; it counts as failed and is
 * tried again the next night. `client` and `timeoutMs` are for tests.
 */
export function createObjectRemover(
  env: NodeJS.ProcessEnv = process.env,
  client?: { send: (command: DeleteObjectCommand, options: { abortSignal: AbortSignal }) => Promise<unknown> },
  timeoutMs = 15_000,
): RemoveObjects | null {
  if (storageDisabled(env)) return null;
  const endpoint = required(env, 'STORAGE_ENDPOINT');
  const bucket = required(env, 'STORAGE_BUCKET');
  const s3 =
    client ??
    new S3Client({
      region: 'auto',
      endpoint,
      forcePathStyle: true,
      credentials: { accessKeyId: required(env, 'STORAGE_ACCESS_KEY_ID'), secretAccessKey: required(env, 'STORAGE_SECRET_ACCESS_KEY') },
    });

  return async (keys) => {
    const failed: string[] = [];
    for (const key of keys) {
      try {
        await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: AbortSignal.timeout(timeoutMs) });
      } catch {
        failed.push(key);
      }
    }
    return { failed };
  };
}
