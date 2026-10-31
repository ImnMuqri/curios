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

  it('leaves nothing behind when a write fails, and keeps an existing file', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'curios-files-'));
    roots.push(root);
    const files = createDiskPrivateFiles(root);
    const broken = () =>
      new Readable({
        read() {
          this.push(Buffer.from('partial'));
          this.destroy(new Error('connection lost'));
        },
      });
    await expect(files.put('item1/new.pdf', broken(), 'application/pdf', 99)).rejects.toThrow('connection lost');
    await expect(files.deliver('item1/new.pdf', 'new.pdf')).rejects.toThrow();
    expect(await readdir(path.join(root, 'item1'))).toEqual([]);

    await files.put('item1/keep.pdf', Buffer.from('original'), 'application/pdf', 8);
    await expect(files.put('item1/keep.pdf', broken(), 'text/html', 99)).rejects.toThrow('connection lost');
    const kept = await files.deliver('item1/keep.pdf', 'keep.pdf');
    if (!('stream' in kept)) throw new Error('expected a stream');
    expect(kept.contentType).toBe('application/pdf');
    expect((await read(kept.stream)).toString()).toBe('original');
    expect((await readdir(path.join(root, 'item1'))).sort()).toEqual(['keep.pdf', 'keep.pdf.type']);
  });

  it('reads a stored file back into memory, and refuses an unsafe key', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'curios-files-'));
    roots.push(root);
    const files = createDiskPrivateFiles(root);
    const bytes = Buffer.from([9, 8, 7, 0, 255]);
    await files.put('item1/o.jpg', bytes, 'image/jpeg', bytes.length);
    expect((await files.read('item1/o.jpg')).equals(bytes)).toBe(true);
    await expect(files.read('../x')).rejects.toThrow('Invalid file key');
  });

  it('delivers an attachment disposition for a non-ASCII name', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'curios-files-'));
    roots.push(root);
    const files = createDiskPrivateFiles(root);
    await files.put('item1/p.svg', Buffer.from('<svg/>'), 'image/svg+xml', 6);
    const out = await files.deliver('item1/p.svg', 'Resipi é.svg');
    if (!('stream' in out)) throw new Error('expected a stream');
    expect(out.disposition).toBe("attachment; filename*=UTF-8''Resipi%20%C3%A9.svg");
    out.stream.resume();
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
