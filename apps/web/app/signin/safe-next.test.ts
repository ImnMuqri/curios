import { describe, expect, it } from 'vitest';
import { safeNext } from './safe-next.js';

describe('safeNext', () => {
  it('keeps a path on this site', () => {
    expect(safeNext('/app/orders?x=1')).toBe('/app/orders?x=1');
  });

  it('falls back to the dashboard for anything else', () => {
    for (const bad of [undefined, '', 'app', 'https://evil.example', '//evil.example', '/\\evil.example', '/\u0000x', 'javascript:alert(1)']) {
      expect(safeNext(bad)).toBe('/app');
    }
  });
});
