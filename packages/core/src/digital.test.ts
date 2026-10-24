import { describe, expect, it } from 'vitest';
import { digitalFacts, fileKind, isDigitalOnly, parseCodes, seatsLeft } from './digital.js';

describe('parseCodes', () => {
  it('trims, drops blanks and duplicates, keeps order', () => {
    expect(parseCodes(' A1 \n\nA1\nB2 ')).toEqual(['A1', 'B2']);
  });
  it('handles Windows line endings and empty input', () => {
    expect(parseCodes('X\r\nY\r\n')).toEqual(['X', 'Y']);
    expect(parseCodes('  \n ')).toEqual([]);
  });
});

describe('isDigitalOnly', () => {
  it('is true only when every line is digital', () => {
    expect(isDigitalOnly([{ kind: 'DIGITAL' }, { kind: 'DIGITAL' }])).toBe(true);
    expect(isDigitalOnly([{ kind: 'DIGITAL' }, { kind: 'PHYSICAL' }])).toBe(false);
  });
  it('is false for no lines', () => {
    expect(isDigitalOnly([])).toBe(false);
  });
});

describe('seatsLeft', () => {
  it('counts down and stops at zero', () => {
    expect(seatsLeft({ seats: 10 }, 3)).toBe(7);
    expect(seatsLeft({ seats: 10 }, 10)).toBe(0);
    expect(seatsLeft({ seats: 10 }, 12)).toBe(0);
  });
});

describe('digitalFacts', () => {
  const now = new Date('2026-10-24T00:00:00Z');
  const stock = { kind: 'DIGITAL' as const, delivery: null, accessUrl: null, files: [], codesLeft: 0, sessions: [] };

  it('calls a physical item plain, whatever else it holds', () => {
    expect(digitalFacts({ ...stock, kind: 'PHYSICAL', delivery: 'CODES', codesLeft: 0 }, now)).toMatchObject({ kind: 'PHYSICAL', soldOut: false, delivery: null });
  });
  it('sells out files with none, a link with none, codes at zero', () => {
    expect(digitalFacts({ ...stock, delivery: 'FILES' }, now).soldOut).toBe(true);
    expect(digitalFacts({ ...stock, delivery: 'FILES', files: [{ name: 'a.pdf', contentType: 'application/pdf' }] }, now).soldOut).toBe(false);
    expect(digitalFacts({ ...stock, delivery: 'LINK' }, now).soldOut).toBe(true);
    expect(digitalFacts({ ...stock, delivery: 'LINK', accessUrl: 'https://x.test' }, now).soldOut).toBe(false);
    expect(digitalFacts({ ...stock, delivery: 'CODES' }, now).soldOut).toBe(true);
    expect(digitalFacts({ ...stock, delivery: 'CODES', codesLeft: 1 }, now).soldOut).toBe(false);
  });
  it('sells out a class when no time to come has a seat, and drops past times', () => {
    const t = (id: string, days: number, seats: number, booked: number) => ({ id, startsAt: new Date(now.getTime() + days * 86_400_000), seats, booked });
    const facts = digitalFacts({ ...stock, delivery: 'SESSION', sessions: [t('past', -1, 5, 0), t('full', 2, 3, 3), t('open', 1, 3, 1)] }, now);
    expect(facts.sessions.map((s) => [s.id, s.seatsLeft])).toEqual([['open', 2], ['full', 0]]);
    expect(facts.soldOut).toBe(false);
    expect(digitalFacts({ ...stock, delivery: 'SESSION', sessions: [t('past', -1, 5, 0), t('full', 2, 3, 3)] }, now).soldOut).toBe(true);
  });
  it('names the file types: extensions first, the content type when there is none', () => {
    expect(fileKind({ name: 'guide.pdf', contentType: 'application/pdf' })).toBe('PDF');
    expect(fileKind({ name: 'song', contentType: 'audio/mpeg' })).toBe('AUDIO');
    expect(digitalFacts({ ...stock, delivery: 'FILES', files: [{ name: 'a.pdf', contentType: '' }, { name: 'b.PDF', contentType: '' }, { name: 'c.zip', contentType: '' }] }, now).format).toEqual({ kinds: ['PDF', 'ZIP'], count: 3 });
  });
});
