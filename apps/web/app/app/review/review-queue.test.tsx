import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../../lib/api.js';
import { ReviewQueue } from './review-queue.js';

// No `vi.mock('next/navigation')` here anymore (F3/A6). `ReviewQueue` no
// longer imports `useRouter` -- it takes a plain `onChanged: () => void`
// prop, called wherever `router.refresh()` used to be called. `Review`
// (untested here, same as `Claim`/`Ingest`/`SignIn`) supplies the real
// `() => router.refresh()`. The guarantee this file cares about --
// "a successful mutation always tells the server side to re-read" -- is
// identical either way: these tests inject a spy for `onChanged` and assert
// it fires after every success, exactly as they asserted on `router.refresh`
// before.

/** The card on top of the stack: the one with controls. */
const topCard = () => screen.getByRole('article', { name: 'Fact to check' });

const facts = [
  {
    id: 'f-1',
    category: 'PRICE' as const,
    claim: 'Kuih lapis is RM12 a box',
    sourceText: 'Our kuih lapis is RM12 per box, minimum two boxes.',
    sourceBefore: null,
    sourceAfter: null,
    sourceUrl: 'https://nadia.example/menu',
    question: 'Berapa harga kuih lapis?',
    confidence: 0.91,
  },
  {
    id: 'f-2',
    category: 'HOURS' as const,
    claim: 'Open 9am to 6pm, Tuesday to Sunday',
    sourceText: 'We open 9-6, Tue-Sun.',
    sourceBefore: null,
    sourceAfter: null,
    sourceUrl: null,
    // Null on purpose: every fact written before the question column existed
    // looks like this, so the queue renders both shapes in one test.
    question: null,
    confidence: 0.8,
  },
];

describe('ReviewQueue', () => {
  it('removes an accepted card from the queue', async () => {
    const onChanged = vi.fn();
    const onAccept = vi.fn().mockResolvedValue(undefined);
    render(
      <ReviewQueue facts={facts} onAccept={onAccept} onEdit={vi.fn()} onReject={vi.fn()} onChanged={onChanged} />,
    );

    await userEvent.click(screen.getByRole('button', { name: /^accept$/i }));

    // The card flies off, then leaves; the next one is on top.
    await waitFor(() => expect(topCard()).toHaveTextContent(/open 9am to 6pm/i));
    expect(screen.queryByText(/kuih lapis is rm12 a box/i, { selector: 'article h2' })).toBeNull();
    // The local removal alone would be a lie about the server's state.
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(onAccept).toHaveBeenCalledWith('f-1');
  });

  it('removes a rejected card from the queue', async () => {
    const onChanged = vi.fn();
    const onReject = vi.fn().mockResolvedValue(undefined);
    render(
      <ReviewQueue facts={facts} onAccept={vi.fn()} onEdit={vi.fn()} onReject={onReject} onChanged={onChanged} />,
    );

    await userEvent.click(screen.getByRole('button', { name: /^reject this fact$/i }));

    await waitFor(() => expect(topCard()).toHaveTextContent(/open 9am to 6pm/i));
    expect(screen.queryByText(/kuih lapis is rm12 a box/i, { selector: 'article h2' })).toBeNull();
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(onReject).toHaveBeenCalledWith('f-1');
  });

  it('keeps an edited card, showing the corrected claim -- an edit is not an acceptance', async () => {
    // Per A3: editFact leaves verified: false. If this ever starts passing
    // because edit removes the card, someone has "simplified" edit into
    // accept and reopened the side door the hard rule was built to close.
    const onChanged = vi.fn();
    const onEdit = vi.fn().mockResolvedValue(undefined);
    render(<ReviewQueue facts={facts} onAccept={vi.fn()} onEdit={onEdit} onReject={vi.fn()} onChanged={onChanged} />);

    await userEvent.click(screen.getByRole('button', { name: /^fix it$/i }));
    const field = screen.getByRole('textbox');
    await userEvent.clear(field);
    await userEvent.type(field, 'Kuih lapis is RM14 a box');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(topCard()).toHaveTextContent(/kuih lapis is rm14 a box/i));
    expect(within(topCard()).getByText('Edited')).toBeInTheDocument();
    // Still in the queue, and the other card was never touched.
    expect(screen.getByText(/open 9am to 6pm/i)).toBeInTheDocument();
    // F3/A6 says onChanged fires "after every successful mutation" -- a
    // successful edit is one, and the pre-fix file never actually asserted
    // this (only the accept/reject tests asserted on `refresh`, not this
    // one), even though `handleEdit`'s success path always called it. See
    // the report: the brief says three existing assertions on `refresh`
    // needed updating; the file only had two.
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('renders the API’s own sentence when an edit collides with an existing fact', async () => {
    // ApiError, not a plain { code, message } object -- the catch this
    // exercises checks `instanceof Error`, and a plain object silently takes
    // the generic branch. Cost six tests a fix round in Task 2.
    const onEdit = vi
      .fn()
      .mockRejectedValue(new ApiError(409, 'FACT_DUPLICATE', 'You already have a fact that says this.'));
    render(<ReviewQueue facts={facts} onAccept={vi.fn()} onEdit={onEdit} onReject={vi.fn()} onChanged={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: /^fix it$/i }));
    const field = screen.getByRole('textbox');
    await userEvent.clear(field);
    await userEvent.type(field, 'Kuih lapis is RM14 a box');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    expect(await screen.findByText(/you already have a fact that says this/i)).toBeInTheDocument();
    // F2/A5: `handleEdit` resolved `false`, so `FactCard` never calls
    // `setEditing(false)` -- the card is still in EDIT mode, not view mode,
    // showing the owner's typed correction still in the textarea rather
    // than reverting to (or silently swapping in) any other claim.
    expect(screen.getByRole('textbox')).toHaveValue('Kuih lapis is RM14 a box');
  });

  it('tells a new account where facts come from, as an instruction rather than a mood', () => {
    render(<ReviewQueue facts={[]} onAccept={vi.fn()} onEdit={vi.fn()} onReject={vi.fn()} onChanged={vi.fn()} />);

    expect(screen.getByText(/nothing to review yet/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add a source' })).toHaveAttribute('href', '/app/knowledge?tab=sources&add=1');
    expect(screen.getByRole('link', { name: 'Write a fact yourself' })).toHaveAttribute('href', '/app/knowledge?tab=facts&add=1');
    // The heading says it once: no "Nothing to check yet" progress line over it.
    expect(screen.queryByText(/nothing to check yet/i)).toBeNull();
    expect(screen.queryByText(/of 0 done/)).toBeNull();
  });

  it('says so when the last fact has been checked', async () => {
    render(
      <ReviewQueue facts={[facts[0]!]} onAccept={vi.fn().mockResolvedValue(undefined)} onEdit={vi.fn()} onReject={vi.fn()} onChanged={vi.fn()} published />,
    );

    await userEvent.click(screen.getByRole('button', { name: /^accept$/i }));

    expect(await screen.findByRole('heading', { name: /nothing left to review/i })).toBeInTheDocument();
    expect(screen.getByText(/already live on your page/i)).toBeInTheDocument();
    // The board's done state: a way on to the facts, and no progress line.
    expect(screen.getByRole('link', { name: 'See your facts' })).toHaveAttribute('href', '/app/knowledge?tab=facts');
    expect(screen.queryByText(/of 1 done/)).toBeNull();
  });

  it('does not call an unpublished page live when everything is checked', async () => {
    render(
      <ReviewQueue facts={[facts[0]!]} onAccept={vi.fn().mockResolvedValue(undefined)} onEdit={vi.fn()} onReject={vi.fn()} onChanged={vi.fn()} published={false} />,
    );

    await userEvent.click(screen.getByRole('button', { name: /^accept$/i }));

    expect(await screen.findByRole('heading', { name: /nothing left to review/i })).toBeInTheDocument();
    expect(screen.getByText(/publish your page so visitors can see it/i)).toBeInTheDocument();
    expect(screen.queryByText(/already live/i)).toBeNull();
  });

  it('counts the whole queue, not only the facts it was handed', () => {
    // The read is bounded at 50; the progress line counts what is waiting.
    render(<ReviewQueue facts={facts} pending={73} onAccept={vi.fn()} onEdit={vi.fn()} onReject={vi.fn()} onChanged={vi.fn()} />);

    expect(screen.getByText('73 left')).toBeInTheDocument();
    expect(screen.getByText('0 of 73 done')).toBeInTheDocument();
  });

  it('keeps the card on a failed decision, and lets the owner try again', async () => {
    const onReject = vi.fn().mockRejectedValueOnce(new ApiError(500, 'INTERNAL', 'The server is having a moment.'));
    render(<ReviewQueue facts={facts} onAccept={vi.fn().mockResolvedValue(undefined)} onEdit={vi.fn()} onReject={onReject} onChanged={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: /^reject this fact$/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The server is having a moment.');
    expect(screen.getByRole('button', { name: /^accept$/i })).not.toBeDisabled();
    expect(topCard()).toHaveTextContent(/kuih lapis is rm12 a box/i);
  });

  it('draws the header, then the notice, then the fact, in one column', () => {
    render(
      <ReviewQueue facts={facts} head={<h1>Review</h1>} footer={<p>Your page is live</p>} onAccept={vi.fn()} onEdit={vi.fn()} onReject={vi.fn()} onChanged={vi.fn()} />,
    );
    const order = [screen.getByRole('heading', { level: 1 }), screen.getByText('Your page is live'), topCard()];
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(screen.queryByText(/once accepted, the chat can say/i)).toBeNull();
    expect(screen.queryByText(/this session/i)).toBeNull();
  });

  it('lists what is up next and what is done, beside the card', async () => {
    const three = [...facts, { ...facts[0]!, id: 'f-3', claim: 'Closed on Mondays' }];
    render(<ReviewQueue facts={three} onAccept={vi.fn().mockResolvedValue(undefined)} onEdit={vi.fn()} onReject={vi.fn()} onChanged={vi.fn()} />);

    const side = screen.getByRole('complementary', { name: 'Up next and done' });
    expect(side).toHaveTextContent('Up next 2');
    expect(side).toHaveTextContent('NextOpen 9am to 6pm, Tuesday to Sunday');
    expect(side).toHaveTextContent('ThenClosed on Mondays');
    expect(side).not.toHaveTextContent('Done');
    expect(screen.getByText('3 left')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /^accept$/i }));
    await waitFor(() => expect(topCard()).toHaveTextContent(/open 9am to 6pm/i));
    expect(side).toHaveTextContent('Done 1');
    expect(side).toHaveTextContent('AcceptedKuih lapis is RM12 a box');
    expect(screen.getByText('2 left')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: '1 of 3 checked' })).toBeInTheDocument();
  });

  it('puts a skipped fact off without discarding it, and brings it back last', async () => {
    const onAccept = vi.fn().mockResolvedValue(undefined);
    const onReject = vi.fn();
    const onChanged = vi.fn();
    render(<ReviewQueue facts={facts} onAccept={onAccept} onEdit={vi.fn()} onReject={onReject} onChanged={onChanged} />);

    await userEvent.click(screen.getByRole('button', { name: /^skip$/i }));

    // The next fact is on top, the skipped one waits behind it, and nothing was sent or counted done.
    expect(topCard()).toHaveTextContent(/open 9am to 6pm/i);
    expect(screen.getByText('2 left')).toBeInTheDocument();
    expect(screen.getByText('0 of 2 done')).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Up next and done' })).toHaveTextContent('NextKuih lapis is RM12 a box');
    expect(onAccept).not.toHaveBeenCalled();
    expect(onReject).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Skipped. It comes back later.');

    // Checking the other one brings the skipped fact back.
    await userEvent.click(screen.getByRole('button', { name: /^accept$/i }));
    await waitFor(() => expect(topCard()).toHaveTextContent(/kuih lapis is rm12 a box/i));
    // With one fact left there is nothing to put it behind.
    expect(screen.getByRole('button', { name: /^skip$/i })).toBeDisabled();
  });

  it('puts a fact that is skipped twice behind the other skipped ones', async () => {
    render(<ReviewQueue facts={facts} onAccept={vi.fn()} onEdit={vi.fn()} onReject={vi.fn()} onChanged={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: /^skip$/i }));
    await userEvent.click(screen.getByRole('button', { name: /^skip$/i }));
    expect(topCard()).toHaveTextContent(/kuih lapis is rm12 a box/i);
  });

  it('acts on the keys F, S and A for the card on top', async () => {
    const onAccept = vi.fn().mockResolvedValue(undefined);
    render(<ReviewQueue facts={facts} onAccept={onAccept} onEdit={vi.fn()} onReject={vi.fn()} onChanged={vi.fn()} />);

    await userEvent.keyboard('s');
    expect(topCard()).toHaveTextContent(/open 9am to 6pm/i);
    await userEvent.keyboard('f');
    expect(screen.getByRole('textbox')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    await userEvent.keyboard('a');
    expect(onAccept).toHaveBeenCalledWith('f-2');
  });

  it('offers no control that acts on more than one fact, mirrored at the container', () => {
    // F1/A4. fact-card.test.tsx's "offers no control that acts on more than
    // this fact" only proves FactCard itself never grows a bulk control --
    // it renders exactly one fact and cannot see ReviewQueue's own markup.
    // ReviewQueue is where a bulk control would actually land, because it
    // already owns the full list and a per-id handler: a
    // `<button onClick={() => visible.forEach((f) => void handleAccept(f.id))}>`
    // is four lines away and would pass every other test in this file. A
    // negative requirement guarded in only one of the two places it can be
    // violated is half a guard -- see Task 6's fix-round-2 report for this
    // test watched failing against a deliberately reintroduced violation.
    render(<ReviewQueue facts={facts} onAccept={vi.fn()} onEdit={vi.fn()} onReject={vi.fn()} onChanged={vi.fn()} />);

    const buttons = screen.getAllByRole('button').map((b) => b.textContent ?? '');
    for (const label of buttons) {
      expect(label).not.toMatch(/all|remaining|rest|everything/i);
    }
    expect(screen.queryByRole('checkbox')).toBeNull();
  });
});

describe('ReviewQueue, without the template look', () => {
  it('has no gradient blobs behind the stack', () => {
    const { container } = render(<ReviewQueue facts={facts} onAccept={vi.fn()} onEdit={vi.fn()} onReject={vi.fn()} onChanged={vi.fn()} />);
    expect(container.querySelector('[class*="blob"]')).toBeNull();
  });
});

describe('Publish on a page that is not public yet', () => {
  const publish = <button type="button">Publish</button>;

  it('moves into the all-done card once the last fact is checked', async () => {
    const one = [facts[0]!];
    render(<ReviewQueue facts={one} published={false} footer={publish} onAccept={vi.fn().mockResolvedValue(undefined)} onEdit={vi.fn()} onReject={vi.fn()} onChanged={vi.fn()} />);
    expect(screen.getAllByRole('button', { name: 'Publish' })).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: /^accept$/i }));
    expect(await screen.findByText('Nothing left to review')).toBeInTheDocument();
    expect(screen.getByText('Last step: publish your page so visitors can see it.')).toBeInTheDocument();
    // Once, and in the card: not also under the header.
    expect(screen.getAllByRole('button', { name: 'Publish' })).toHaveLength(1);
    expect(screen.queryByRole('link', { name: 'See your facts' })).toBeNull();
  });

  it('stays under the header before any fact arrives', () => {
    render(<ReviewQueue facts={[]} published={false} footer={publish} onAccept={vi.fn()} onEdit={vi.fn()} onReject={vi.fn()} onChanged={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Publish' })).toBeInTheDocument();
    expect(screen.queryByText('Nothing left to review')).toBeNull();
  });

  it('leaves the all-done card as it was on a published page', async () => {
    render(<ReviewQueue facts={[facts[0]!]} published footer={<p>Your page is live</p>} onAccept={vi.fn().mockResolvedValue(undefined)} onEdit={vi.fn()} onReject={vi.fn()} onChanged={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /^accept$/i }));
    expect(await screen.findByRole('link', { name: 'See your facts' })).toBeInTheDocument();
    expect(screen.getByText('Everything you accepted is already live on your page.')).toBeInTheDocument();
  });
});
