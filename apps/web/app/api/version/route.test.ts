import { describe, expect, it } from 'vitest';
import { GET } from './route.js';

describe('GET /api/version', () => {
  it('answers with the running build, never cached', async () => {
    const res = GET();
    expect(res.headers.get('cache-control')).toBe('no-store');
    // Tests are not a production build: "development", which the dashboard never compares.
    expect(await res.json()).toEqual({ version: 'development' });
  });
});
