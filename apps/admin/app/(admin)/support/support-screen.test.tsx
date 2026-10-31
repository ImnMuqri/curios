import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh }) }));
const apiFetch = vi.fn();
vi.mock('../../../lib/api.js', () => ({
  API_BASE: 'http://api.test',
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  ApiError: class ApiError extends Error {
    constructor(
      readonly status: number,
      readonly code: string,
      message: string,
    ) {
      super(message);
    }
  },
}));

import { SupportScreen, type SupportMessage, type SupportThread, type SupportThreadDetail } from './support-screen.js';

const thread = (over: Partial<SupportThread> = {}): SupportThread => ({
  id: 't1',
  address: 'aisyah@example.com',
  name: 'Aisyah',
  subject: 'Cannot publish my page',
  status: 'OPEN',
  unread: true,
  lastMessageAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  attachmentCount: 2,
  owner: { pageId: 'p1', handle: 'kedaiaisyah', displayName: 'Kedai Aisyah' },
  ...over,
});

const message = (over: Partial<SupportMessage> = {}): SupportMessage => ({
  id: 'm1',
  direction: 'IN',
  fromAddress: 'aisyah@example.com',
  fromName: 'Aisyah',
  createdAt: '2026-10-30T02:00:00.000Z',
  text: 'It says error.',
  html: '<p>It says <b>error</b>.</p>',
  sendStatus: null,
  sentBy: null,
  attachments: [],
  ...over,
});

const stranger = thread({ id: 't2', address: 'someone@example.net', name: null, subject: 'Partnership', unread: false, attachmentCount: 0, owner: null });

let threads: SupportThread[];
let detail: Record<string, SupportThreadDetail>;
let counts: { open: number; done: number; spam: number };

/** Answers the screen's calls the way the API would, and lets one test override one route. */
function serve(overrides: Record<string, (init?: RequestInit) => unknown> = {}) {
  apiFetch.mockImplementation(async (path: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${path.split('?')[0]}`;
    if (overrides[key]) return overrides[key](init);
    if (key === 'GET /admin/support/counts') return counts;
    if (key === 'GET /admin/support/threads') return { threads, next: null };
    const one = /^GET \/admin\/support\/threads\/(\w+)$/.exec(key);
    if (one) return detail[one[1]!];
    if (key.startsWith('POST ')) return null;
    throw new Error(`unexpected ${key}`);
  });
}

/** The messages, not the attachment lists nested in them. */
const messages = () => {
  const list = screen.getByRole('list', { name: 'Messages' });
  return within(list)
    .getAllByRole('listitem')
    .filter((li) => li.parentElement === list);
};

const calls = (method: string, path: string) =>
  apiFetch.mock.calls.filter(([p, init]) => (init?.method ?? 'GET') === method && p === path);

beforeEach(() => {
  apiFetch.mockReset();
  threads = [thread(), stranger];
  counts = { open: 7, done: 3, spam: 1 };
  detail = {
    t1: {
      thread: thread(),
      owner: { pageId: 'p1', handle: 'kedaiaisyah', displayName: 'Kedai Aisyah', plan: 'Business', paidUntil: '2026-12-01T00:00:00.000Z' },
      messages: [
        message({
          attachments: [{ id: 'a1', fileName: 'screenshot.png', contentType: 'image/png', sizeBytes: 20480, inline: false }],
        }),
        message({
          id: 'm2',
          direction: 'OUT',
          fromAddress: 'support@curios.my',
          fromName: 'Curios Support',
          createdAt: '2026-10-30T03:00:00.000Z',
          text: 'Which page is it?',
          html: null,
          sendStatus: 'SENT',
          sentBy: { name: 'Iman' },
        }),
        message({ id: 'm3', createdAt: '2026-10-30T04:00:00.000Z', text: 'curios.my/kedaiaisyah', html: null }),
      ],
    },
    t2: { thread: stranger, owner: null, messages: [message({ id: 'm9', fromAddress: 'someone@example.net', fromName: null })] },
  };
  serve();
});

async function openFirst() {
  const user = userEvent.setup();
  render(<SupportScreen />);
  await user.click(await screen.findByRole('button', { name: /Kedai Aisyah/ }));
  await screen.findByRole('heading', { name: 'Cannot publish my page', level: 2 });
  return user;
}

describe('SupportScreen', () => {
  it('lists each conversation: sender, subject, paperclip count and unread marker', async () => {
    render(<SupportScreen />);

    const list = await screen.findByRole('list', { name: 'Conversations' });
    const [first, second] = within(list).getAllByRole('button');
    expect(first).toHaveTextContent('Kedai Aisyah');
    expect(first).toHaveTextContent('curios.my/kedaiaisyah');
    expect(first).toHaveTextContent('Cannot publish my page');
    expect(within(first!).getByLabelText('2 attachments')).toBeInTheDocument();
    expect(within(first!).getByText('Unread')).toBeInTheDocument();
    expect(first).toHaveTextContent('5 min ago');

    expect(second).toHaveTextContent('someone@example.net');
    expect(second).toHaveTextContent('Partnership');
    expect(within(second!).queryByText('Unread')).not.toBeInTheDocument();
    expect(within(second!).queryByLabelText(/attachment/)).not.toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledWith('/admin/support/threads?status=open');
  });

  it('filters by Open with its count, Done, All and Spam', async () => {
    const user = userEvent.setup();
    render(<SupportScreen />);

    const tabs = within(screen.getByRole('navigation', { name: 'Filter conversations' }));
    expect(await tabs.findByRole('button', { name: 'Open 7' })).toHaveAttribute('aria-current', 'true');
    expect(tabs.getAllByRole('button').map((b) => b.textContent)).toEqual(['Open7', 'Done', 'All', 'Spam']);

    await user.click(tabs.getByRole('button', { name: 'Spam' }));
    expect(tabs.getByRole('button', { name: 'Spam' })).toHaveAttribute('aria-current', 'true');
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/admin/support/threads?status=spam'));
  });

  it('searches by sender or subject', async () => {
    const user = userEvent.setup();
    render(<SupportScreen />);
    await screen.findByRole('list', { name: 'Conversations' });

    await user.type(screen.getByRole('searchbox', { name: 'Search conversations' }), 'refund{Enter}');
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/admin/support/threads?status=open&q=refund'));
  });

  it('opens a conversation with the owner card linking to their page on Pages', async () => {
    await openFirst();

    const card = screen.getByRole('region', { name: 'Owner' });
    expect(card).toHaveTextContent('Kedai Aisyah');
    expect(card).toHaveTextContent('curios.my/kedaiaisyah');
    expect(card).toHaveTextContent('Business');
    expect(card).toHaveTextContent('1 Dec 2026');
    expect(within(card).getByRole('link', { name: 'Open in Pages' })).toHaveAttribute('href', '/pages?page=p1');
    expect(screen.getByRole('button', { name: /Kedai Aisyah/ })).toHaveAttribute('aria-current', 'true');
  });

  it('marks an unread conversation read once, and clears its marker', async () => {
    await openFirst();

    await waitFor(() => expect(calls('POST', '/admin/support/threads/t1/read')).toHaveLength(1));
    const row = screen.getByRole('button', { name: /Kedai Aisyah/ });
    expect(within(row).queryByText('Unread')).not.toBeInTheDocument();
  });

  it('does not post read for a conversation already read', async () => {
    const user = userEvent.setup();
    render(<SupportScreen />);
    await user.click(await screen.findByRole('button', { name: /someone@example\.net/ }));
    await screen.findByRole('heading', { name: 'Partnership', level: 2 });

    expect(calls('POST', '/admin/support/threads/t2/read')).toHaveLength(0);
    expect(screen.queryByRole('region', { name: 'Owner' })).not.toBeInTheDocument();
  });

  it('shows the messages in order, who sent each, and a download link for each attachment', async () => {
    await openFirst();

    const items = messages();
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('Aisyah');
    expect(items[1]).toHaveTextContent('Iman');
    expect(items[1]).toHaveTextContent('Which page is it?');
    expect(items[2]).toHaveTextContent('curios.my/kedaiaisyah');

    const file = within(items[0]!).getByRole('link', { name: /screenshot\.png/ });
    expect(file).toHaveAttribute('href', 'http://api.test/admin/support/attachments/a1');
    expect(file).toHaveAttribute('download');
  });

  it('shows email HTML only in a frame sandboxed without scripts or same-origin', async () => {
    await openFirst();

    const frame = screen.getByTitle('Email');
    expect(frame.tagName).toBe('IFRAME');
    expect(frame.getAttribute('sandbox')).toBe('allow-popups allow-popups-to-escape-sandbox');
    expect(frame.getAttribute('srcdoc')).toContain('<p>It says <b>error</b>.</p>');
    expect(frame.getAttribute('srcdoc')).toContain("default-src 'none'");
  });

  it('offers Show images only for remote images, and lets them load once pressed', async () => {
    detail.t1!.messages = [message({ html: '<p>Hi</p><img src="https://track.example/p.gif">' })];
    const user = await openFirst();

    const frame = screen.getByTitle('Email');
    expect(frame.getAttribute('srcdoc')).toContain('img-src data:"');
    await user.click(screen.getByRole('button', { name: 'Show images' }));
    expect(screen.getByTitle('Email').getAttribute('srcdoc')).toContain('img-src data: https:"');
    expect(screen.queryByRole('button', { name: 'Show images' })).not.toBeInTheDocument();
  });

  it('has no Show images for an email without remote images', async () => {
    await openFirst();

    expect(screen.queryByRole('button', { name: 'Show images' })).not.toBeInTheDocument();
  });

  it('sends a reply as { text } and shows it as Sending…', async () => {
    serve({
      'POST /admin/support/threads/t1/reply': () => ({
        message: message({
          id: 'm4',
          direction: 'OUT',
          fromAddress: 'support@curios.my',
          fromName: 'Curios Support',
          createdAt: '2026-10-31T02:00:00.000Z',
          text: 'Fixed it for you.',
          html: null,
          sendStatus: 'SENDING',
          sentBy: { name: 'Iman' },
        }),
      }),
    });
    const user = await openFirst();

    await user.type(screen.getByRole('textbox', { name: 'Reply' }), 'Fixed it for you.');
    await user.click(screen.getByRole('button', { name: 'Send reply' }));

    const sent = calls('POST', '/admin/support/threads/t1/reply');
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0]![1].body)).toEqual({ text: 'Fixed it for you.' });
    const items = messages();
    expect(items).toHaveLength(4);
    expect(items[3]).toHaveTextContent('Fixed it for you.');
    expect(items[3]).toHaveTextContent('Sending…');
    expect(screen.getByRole('textbox', { name: 'Reply' })).toHaveValue('');
  });

  it('says Not sent when the reply could not be queued, and reads the thread again to show it with Retry', async () => {
    const { ApiError } = await import('../../../lib/api.js');
    serve({
      'POST /admin/support/threads/t1/reply': () => {
        throw new ApiError(500, 'REPLY_NOT_QUEUED', 'The reply was saved but not queued.');
      },
    });
    const user = await openFirst();

    await user.type(screen.getByRole('textbox', { name: 'Reply' }), 'Hello');
    await user.click(screen.getByRole('button', { name: 'Send reply' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Not sent');
    // The API stored it as FAILED: the thread is read again so it shows with Retry, and the draft
    // is cleared so it is not sent twice.
    await waitFor(() => expect(calls('GET', '/admin/support/threads/t1')).toHaveLength(2));
    expect(screen.getByRole('textbox', { name: 'Reply' })).toHaveValue('');
  });

  it('shows a failed reply as Not sent, with Retry calling the retry route', async () => {
    detail.t1!.messages[1] = { ...detail.t1!.messages[1]!, sendStatus: 'FAILED' };
    const user = await openFirst();

    const failed = messages()[1]!;
    expect(failed).toHaveTextContent('Not sent');
    await user.click(within(failed).getByRole('button', { name: 'Retry' }));

    expect(calls('POST', '/admin/support/messages/m2/retry')).toHaveLength(1);
    expect(failed).toHaveTextContent('Sending…');
    expect(within(failed).queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('marks a conversation done', async () => {
    const user = await openFirst();

    await user.click(screen.getByRole('button', { name: 'Mark done' }));

    const posted = calls('POST', '/admin/support/threads/t1/status');
    expect(posted).toHaveLength(1);
    expect(JSON.parse(posted[0]![1].body)).toEqual({ status: 'DONE' });
    expect(await screen.findByRole('status')).toHaveTextContent('Marked done.');
    expect(screen.getByRole('button', { name: 'Reopen' })).toBeInTheDocument();
    // Gone from the Open list, and the sidebar's count is read again.
    expect(screen.queryByRole('button', { name: /Kedai Aisyah/ })).not.toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });

  it('offers Not spam instead of Mark done on a spam conversation, which moves it back to Open', async () => {
    const spam = thread({ id: 't3', subject: 'You won', status: 'SPAM', unread: false, owner: null, address: 'win@spam.example', name: null });
    threads = [spam];
    detail.t3 = { thread: spam, owner: null, messages: [message({ id: 'm7', fromAddress: 'win@spam.example', fromName: null })] };
    const user = userEvent.setup();
    render(<SupportScreen />);
    await user.click(await screen.findByRole('button', { name: /win@spam\.example/ }));
    await screen.findByRole('heading', { name: 'You won', level: 2 });

    expect(screen.queryByRole('button', { name: 'Mark done' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Not spam' }));

    const posted = calls('POST', '/admin/support/threads/t3/status');
    expect(JSON.parse(posted[0]![1].body)).toEqual({ status: 'OPEN' });
  });

  it('goes back to the list from a conversation (the narrow layout’s Back link)', async () => {
    const user = await openFirst();

    await user.click(screen.getByRole('button', { name: 'Back to conversations' }));
    expect(screen.queryByRole('heading', { name: 'Cannot publish my page', level: 2 })).not.toBeInTheDocument();
  });
});
