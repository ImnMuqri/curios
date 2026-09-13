import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FREE_LEADS, planState } from '@curios/core';
import { TrialNotice, trialNotice } from './trial-notice.js';

const NOW = new Date('2026-09-13T00:00:00Z');
const FUTURE = new Date('2026-10-13T00:00:00Z');
const PAST = new Date('2026-08-13T00:00:00Z');

/**
 * Built through `planState` rather than by hand-writing the state objects.
 * The point of this screen is that an owner is told the truth about their own
 * page, so the fixtures start from the same columns the page has.
 */
const from = (page: { mode: 'PERSONAL' | 'BUSINESS'; paidUntil: Date | null; leadsCaptured: number }) =>
  planState({ ...page, now: NOW });

describe('trialNotice', () => {
  it('says nothing to a personal page, which never captures', () => {
    expect(trialNotice(from({ mode: 'PERSONAL', paidUntil: null, leadsCaptured: 0 }))).toBeNull();
  });

  it('says nothing to a paid page, even one that spent its trial first', () => {
    expect(
      trialNotice(from({ mode: 'BUSINESS', paidUntil: FUTURE, leadsCaptured: FREE_LEADS })),
    ).toBeNull();
  });

  it('counts the trial down, and warns what happens at the end of it', () => {
    const notice = trialNotice(from({ mode: 'BUSINESS', paidUntil: null, leadsCaptured: 2 }));

    expect(notice?.text).toContain(`2 of your ${FREE_LEADS} free leads used`);
    // The count without the consequence would still leave the card vanishing
    // as a surprise, which is the whole finding this screen answers.
    expect(notice?.text).toContain('stops appearing');
  });

  it('tells a spent trial that only capture stopped', () => {
    const notice = trialNotice(from({ mode: 'BUSINESS', paidUntil: null, leadsCaptured: FREE_LEADS }));

    expect(notice?.tone).toBe('action');
    expect(notice?.text).toContain('no longer shown');
    // A lapse withdraws capture and nothing else. An owner who thinks their
    // page went dark would reasonably panic.
    expect(notice?.text).toContain('Everything else still works');
  });

  it('tells a lapsed page it lapsed, and when, rather than calling it a spent trial', () => {
    const notice = trialNotice(
      from({ mode: 'BUSINESS', paidUntil: PAST, leadsCaptured: FREE_LEADS }),
    );

    expect(notice?.text).toContain('subscription ended');
    expect(notice?.text).toContain('2026');
    expect(notice?.text).not.toContain('free leads');
  });
});

describe('TrialNotice', () => {
  it('renders nothing at all for a paid page, not an empty box', () => {
    const { container } = render(
      <TrialNotice state={from({ mode: 'BUSINESS', paidUntil: FUTURE, leadsCaptured: 0 })} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the count where an owner will see it', () => {
    render(<TrialNotice state={from({ mode: 'BUSINESS', paidUntil: null, leadsCaptured: 1 })} />);
    expect(screen.getByRole('status')).toHaveTextContent(`1 of your ${FREE_LEADS} free leads used`);
  });
});
