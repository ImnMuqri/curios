import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

export const STORAGE_ENV = [
  'STORAGE_ENDPOINT',
  'STORAGE_BUCKET',
  'STORAGE_ACCESS_KEY_ID',
  'STORAGE_SECRET_ACCESS_KEY',
  'STORAGE_PUBLIC_URL',
] as const;

/**
 * Whether pictures are switched off in this process: outside production, and
 * only when none of the storage settings is set -- the rule billingDisabled
 * set for Billplz. A partial set is a mistake and falls through to the
 * per-setting check that names the missing one.
 */
export function storageDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV === 'production') return false;
  return STORAGE_ENV.every((name) => !env[name]);
}

// Function-typed properties, not method shorthand: avatar.routes.test.ts reads
// `store.put`/`store.remove` off the object directly to assert on the mock,
// and TS method shorthand carries an implicit `this` that
// `@typescript-eslint/unbound-method` rightly distrusts once detached like that.
export interface AvatarStore {
  put: (key: string, body: Buffer, contentType: string) => Promise<void>;
  remove: (key: string) => Promise<void>;
}

function required(env: NodeJS.ProcessEnv, name: (typeof STORAGE_ENV)[number]): string {
  const value = env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/** R2 or S3, through the one SDK that speaks to both. */
export function createS3Store(env: NodeJS.ProcessEnv = process.env): AvatarStore {
  const bucket = required(env, 'STORAGE_BUCKET');
  required(env, 'STORAGE_PUBLIC_URL');
  const client = new S3Client({
    region: 'auto',
    endpoint: required(env, 'STORAGE_ENDPOINT'),
    forcePathStyle: true,
    credentials: {
      accessKeyId: required(env, 'STORAGE_ACCESS_KEY_ID'),
      secretAccessKey: required(env, 'STORAGE_SECRET_ACCESS_KEY'),
    },
  });
  return {
    async put(key, body, contentType) {
      await client.send(
        new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType, CacheControl: 'public, max-age=31536000, immutable' }),
      );
    },
    async remove(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}

/**
 * The store a route plugin uploads to: the one a test passed, none when a test
 * passed null, otherwise one built from the environment -- or none in
 * development with no storage settings. Resolved at registration, so a
 * production deploy with a missing setting fails at boot, not on an upload.
 */
export function resolveStore(option: AvatarStore | null | undefined): AvatarStore | null {
  if (option !== undefined) return option;
  return storageDisabled() ? null : createS3Store();
}
