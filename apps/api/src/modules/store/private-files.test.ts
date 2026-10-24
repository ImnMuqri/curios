import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { S3Client } from '@aws-sdk/client-s3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDiskPrivateFiles, createS3PrivateFiles, resolvePrivateFiles } from './private-files.js';

async function read(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks);
}

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

describe('disk private files', () => {
  it('round-trips a stream and a buffer, then removes them', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'curios-files-'));
    roots.push(root);
    const files = createDiskPrivateFiles(root);
    await files.put('item1/a.pdf', Readable.from([Buffer.from('hello '), Buffer.from('world')]), 'application/pdf', 11);
    await files.put('item1/b.bin', Buffer.from([1, 2, 3]), 'application/zip', 3);
    const a = await files.deliver('item1/a.pdf', 'a.pdf');
    if (!('stream' in a)) throw new Error('expected a stream');
    expect(a.contentType).toBe('application/pdf');
    expect((await read(a.stream)).toString()).toBe('hello world');
    await files.remove('item1/a.pdf');
    await files.remove('item1/a.pdf');
    await files.remove('item1/b.bin');
    expect(await readdir(path.join(root, 'item1'))).toEqual([]);
  });

  it.each(['../x', 'a/../../x', '/etc/passwd', 'a\\b', 'C:/x', '', 'a//b', './a'])('refuses the key %j', async (key) => {
    const files = createDiskPrivateFiles(path.join(tmpdir(), 'curios-never-written'));
    await expect(files.put(key, Buffer.from('x'), 'text/plain', 1)).rejects.toThrow('Invalid file key');
    await expect(files.remove(key)).rejects.toThrow('Invalid file key');
    await expect(files.deliver(key, 'x')).rejects.toThrow('Invalid file key');
  });
});

describe('S3 private files', () => {
  const env = {
    STORAGE_ENDPOINT: 'https://acct.r2.cloudflarestorage.com',
    STORAGE_PRIVATE_BUCKET: 'curios-private',
    STORAGE_ACCESS_KEY_ID: 'id',
    STORAGE_SECRET_ACCESS_KEY: 'secret',
  };

  it('delivers a five-minute presigned link that forces a download under the file name', async () => {
    const client = new S3Client({ region: 'auto', endpoint: env.STORAGE_ENDPOINT, forcePathStyle: true, credentials: { accessKeyId: 'id', secretAccessKey: 'secret' } });
    const out = await createS3PrivateFiles(env, client).deliver('item1/a.pdf', 'My file é.pdf');
    if (!('redirect' in out)) throw new Error('expected a redirect');
    const url = new URL(out.redirect);
    expect(url.pathname).toBe('/curios-private/item1/a.pdf');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(url.searchParams.get('response-content-disposition')).toBe("attachment; filename*=UTF-8''My%20file%20%C3%A9.pdf");
  });

  it('sends deletes to the private bucket', async () => {
    const send = vi.fn().mockResolvedValue({});
    const client = { send, config: {} } as unknown as S3Client;
    await createS3PrivateFiles(env, client).remove('item1/a.pdf');
    expect(send).toHaveBeenCalledTimes(1);
    expect((send.mock.calls[0]![0] as { input: { Bucket: string; Key: string } }).input).toEqual({ Bucket: 'curios-private', Key: 'item1/a.pdf' });
  });

  it('names the missing private bucket', () => {
    const { STORAGE_PRIVATE_BUCKET: _omitted, ...rest } = env;
    expect(() => createS3PrivateFiles(rest)).toThrow(/STORAGE_PRIVATE_BUCKET is not set/);
  });
});

describe('resolvePrivateFiles', () => {
  it('returns what a test passed, null included', () => {
    expect(resolvePrivateFiles(null)).toBeNull();
    const fake = {} as ReturnType<typeof createDiskPrivateFiles>;
    expect(resolvePrivateFiles(fake)).toBe(fake);
  });
  it('uses the disk in development, never null', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('STORAGE_PRIVATE_BUCKET', '');
    expect(resolvePrivateFiles()).not.toBeNull();
  });
  it('throws at resolve in production without the private bucket', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('STORAGE_PRIVATE_BUCKET', '');
    expect(() => resolvePrivateFiles()).toThrow(/is not set/);
  });
});
