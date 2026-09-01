import { describe, expect, it } from 'vitest';
import { checkHandle, handleSkeleton } from './handle.js';

describe('handleSkeleton', () => {
  it('folds accented letters onto their plain forms', () => {
    // What NFKD plus mark-stripping actually buys: every accented variant of a
    // Malay name collapses onto one shape.
    expect(handleSkeleton('nádiá')).toBe('nadia');
    expect(handleSkeleton('nàdîâ')).toBe('nadia');
  });

  it('does not fold a dotless i, and does not need to', () => {
    // U+0131 is an atomic letter, not a decomposition, so NFKD leaves it
    // alone. That is fine: the character class rejects it outright, which is a
    // stronger guarantee than folding would be. Asserted rather than left
    // implicit, so nobody "fixes" the skeleton to chase it.
    expect(handleSkeleton('nadıa')).not.toBe(handleSkeleton('nadia'));
  });

  it('folds zero to o and one to i', () => {
    expect(handleSkeleton('n0d1a')).toBe('nodia');
  });

  it('does not fold letters onto each other', () => {
    // Folding {1, l, i} together maps mail and mall to one skeleton. Two
    // ordinary words, one of which could then never be claimed.
    expect(handleSkeleton('mail')).not.toBe(handleSkeleton('mall'));
  });

  it('leaves digits people legitimately want alone', () => {
    // web3, 4u, 5star and 88 are all things a real shop asks for, and 88 is
    // culturally meaningful in this market.
    for (const handle of ['web3', '4u', '5star', '88shop']) {
      expect(handleSkeleton(handle)).toBe(handle);
    }
  });
});

describe('checkHandle', () => {
  it('accepts an ordinary handle and returns both forms', () => {
    expect(checkHandle('Nadia_Bakes')).toEqual({
      ok: true,
      handle: 'nadia_bakes',
      skeleton: 'nadia_bakes',
    });
  });

  it('rejects anything outside the character class or the length', () => {
    for (const bad of ['ab', 'a'.repeat(31), 'nadia bakes', 'nadia!', 'nadia.bakes']) {
      expect(checkHandle(bad)).toEqual({ ok: false, reason: 'FORMAT' });
    }
  });

  it('rejects a leading or trailing separator', () => {
    for (const bad of ['_nadia', 'nadia_', '-nadia', 'nadia-']) {
      expect(checkHandle(bad)).toEqual({ ok: false, reason: 'FORMAT' });
    }
  });

  it('rejects a reserved route name', () => {
    for (const bad of ['admin', 'api', 'app', 'auth', 'www', 'settings', 'privacy']) {
      expect(checkHandle(bad)).toEqual({ ok: false, reason: 'RESERVED' });
    }
  });

  it('rejects profanity and a Malaysian trademark', () => {
    // The spec asks for both alongside the route names. They were missing for
    // eight tasks because the requirement never reached a task brief.
    expect(checkHandle('cunt')).toEqual({ ok: false, reason: 'RESERVED' });
    expect(checkHandle('pukimak')).toEqual({ ok: false, reason: 'RESERVED' });
    expect(checkHandle('maybank')).toEqual({ ok: false, reason: 'RESERVED' });
    expect(checkHandle('mysejahtera')).toEqual({ ok: false, reason: 'RESERVED' });
  });

  it('catches a trademark disguised with the same fold the routes use', () => {
    // The reserved check runs against the skeleton, so every entry gets the
    // digit folds for free -- including the two lists added last.
    expect(checkHandle('petr0nas')).toEqual({ ok: false, reason: 'RESERVED' });
    expect(checkHandle('a1rasia')).toEqual({ ok: false, reason: 'RESERVED' });
  });

  it('still accepts ordinary words that are merely near a blocked one', () => {
    // Exact match, not substring. A namespace that rejects ordinary handles to
    // catch rude ones is the worse product, and the residual gap goes to the
    // takedown path BACKEND.md specifies.
    for (const fine of ['maybankers', 'shipping', 'grabfood', 'bassist']) {
      expect(checkHandle(fine)).toMatchObject({ ok: true });
    }
  });

  it('rejects a reserved handle disguised with leetspeak', () => {
    // This is where the skeleton earns its place: the reserved check runs
    // against the folded form, so adm1n cannot walk past a list containing
    // admin.
    expect(checkHandle('adm1n')).toEqual({ ok: false, reason: 'RESERVED' });
  });

  it('rejects a non-ASCII lookalike on format, before the reserved list', () => {
    // admın never reaches the reserved check, because the character class does
    // not admit U+0131 at all. Two rules, and the blunter one fires first.
    expect(checkHandle('admın')).toEqual({ ok: false, reason: 'FORMAT' });
  });
});
