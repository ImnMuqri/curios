import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { DeleteObjectCommand, GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/** How long a presigned download link works. */
export const PRIVATE_LINK_SECONDS = 300;

// Function-typed properties, as AvatarStore does: tests read them off the
// object to assert on a mock.
export interface PrivateFiles {
  put: (key: string, body: NodeJS.ReadableStream | Buffer, contentType: string, sizeBytes: number) => Promise<void>;
  remove: (key: string) => Promise<void>;
  deliver: (
    key: string,
    fileName: string,
  ) => Promise<{ redirect: string } | { stream: NodeJS.ReadableStream; contentType: string }>;
}

/** `attachment; filename*=UTF-8''...` -- RFC 5987 encoding, so any name is safe in a header. */
export function attachmentDisposition(fileName: string): string {
  const encoded = encodeURIComponent(fileName).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename*=UTF-8''${encoded}`;
}

/** A key is a relative path of plain segments; anything that could leave the folder is refused. */
export function assertSafeKey(key: string): void {
  const bad =
    key.length === 0 ||
    key.includes('\\') ||
    key.includes('\0') ||
    key.startsWith('/') ||
    /^[a-zA-Z]:/.test(key) ||
    key.split('/').some((segment) => segment === '' || segment === '.' || segment === '..');
  if (bad) throw new Error('Invalid file key');
}

const DEFAULT_ROOT = fileURLToPath(new URL('../../../.files', import.meta.url));

/** Development stand-in for the private bucket: files under apps/api/.files/. */
export function createDiskPrivateFiles(root: string = DEFAULT_ROOT): PrivateFiles {
  const base = path.resolve(root);
  const locate = (key: string): string => {
    assertSafeKey(key);
    const full = path.resolve(base, ...key.split('/'));
    if (!full.startsWith(base + path.sep)) throw new Error('Invalid file key');
    return full;
  };
  return {
    async put(key, body, contentType) {
      const file = locate(key);
      await mkdir(path.dirname(file), { recursive: true });
      if (Buffer.isBuffer(body)) await writeFile(file, body);
      else await pipeline(body as Readable, createWriteStream(file));
      await writeFile(`${file}.type`, contentType, 'utf8');
    },
    async remove(key) {
      const file = locate(key);
      await rm(file, { force: true });
      await rm(`${file}.type`, { force: true });
    },
    async deliver(key) {
      const file = locate(key);
      const contentType = await readFile(`${file}.type`, 'utf8').catch(() => 'application/octet-stream');
      return { stream: createReadStream(file), contentType };
    },
  };
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/**
 * The private bucket, in the same R2 or S3 account as the pictures. Uploads go
 * through lib-storage's Upload: it streams the body in multipart chunks (a
 * 100 MB file is never held in memory) and, unlike a bare PutObject with a
 * stream, needs neither a seekable body nor a pre-computed checksum.
 */
export function createS3PrivateFiles(env: NodeJS.ProcessEnv = process.env, client?: S3Client): PrivateFiles {
  const bucket = required(env, 'STORAGE_PRIVATE_BUCKET');
  const s3 =
    client ??
    new S3Client({
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
      assertSafeKey(key);
      await new Upload({
        client: s3,
        params: { Bucket: bucket, Key: key, Body: body as Readable | Buffer, ContentType: contentType },
      }).done();
    },
    async remove(key) {
      assertSafeKey(key);
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
    async deliver(key, fileName) {
      assertSafeKey(key);
      const redirect = await getSignedUrl(
        s3,
        new GetObjectCommand({ Bucket: bucket, Key: key, ResponseContentDisposition: attachmentDisposition(fileName) }),
        { expiresIn: PRIVATE_LINK_SECONDS },
      );
      return { redirect };
    },
  };
}

/**
 * The store downloads use: the one a test passed, otherwise S3 when the bucket
 * is set or in production (where a missing setting throws at registration, so
 * a deploy fails at boot), otherwise the disk -- so development always works.
 */
export function resolvePrivateFiles(option?: PrivateFiles | null): PrivateFiles | null {
  if (option !== undefined) return option;
  if (process.env.NODE_ENV === 'production' || process.env.STORAGE_PRIVATE_BUCKET) return createS3PrivateFiles();
  return createDiskPrivateFiles();
}
