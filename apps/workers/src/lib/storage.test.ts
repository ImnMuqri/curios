import { describe, expect, it, vi } from 'vitest';
import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { createObjectRemover, storageDisabled } from './storage.js';

const env = {
  STORAGE_ENDPOINT: 'https://r2.example',
  STORAGE_BUCKET: 'curios',
  STORAGE_ACCESS_KEY_ID: 'id',
  STORAGE_SECRET_ACCESS_KEY: 'secret',
  STORAGE_PUBLIC_URL: 'https://files.example',
} as NodeJS.ProcessEnv;

describe('storageDisabled', () => {
  it('is off with no storage settings outside production, as the API decides', () => {
    expect(storageDisabled({ NODE_ENV: 'development' })).toBe(true);
    expect(storageDisabled({ ...env, NODE_ENV: 'development' })).toBe(false);
    expect(storageDisabled({ NODE_ENV: 'production' })).toBe(false);
  });
});

describe('createObjectRemover', () => {
  it('is null when storage is off', () => {
    expect(createObjectRemover({ NODE_ENV: 'test' })).toBeNull();
  });

  it('names the missing setting of a partial set', () => {
    expect(() => createObjectRemover({ STORAGE_BUCKET: 'curios' })).toThrow('STORAGE_ENDPOINT is not set');
  });

  it('deletes each key from the bucket, and reports the ones that failed', async () => {
    const send = vi.fn(async (command: DeleteObjectCommand) => {
      if (command.input.Key === 'receipts/p/bad.jpg') throw new Error('denied');
      return {};
    });
    const removeObjects = createObjectRemover(env, { send })!;

    expect(await removeObjects(['receipts/p/a.jpg', 'receipts/p/bad.jpg'])).toEqual({ failed: ['receipts/p/bad.jpg'] });
    expect(send.mock.calls.map(([command]) => [command.input.Bucket, command.input.Key])).toEqual([
      ['curios', 'receipts/p/a.jpg'],
      ['curios', 'receipts/p/bad.jpg'],
    ]);
  });

  it('gives up on a delete that hangs, counts it failed, and goes on to the next', async () => {
    const send = vi.fn(
      (command: DeleteObjectCommand, options: { abortSignal: AbortSignal }) =>
        new Promise((resolve, reject) => {
          if (command.input.Key !== 'receipts/p/hung.jpg') return resolve({});
          options.abortSignal.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const removeObjects = createObjectRemover(env, { send }, 20)!;

    expect(await removeObjects(['receipts/p/hung.jpg', 'receipts/p/b.jpg'])).toEqual({ failed: ['receipts/p/hung.jpg'] });
    expect(send).toHaveBeenCalledTimes(2);
  });
});
