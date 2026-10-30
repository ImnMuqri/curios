import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { ApiError } from '../../../lib/api.js';
import { checkDigital, digitalDraftOf, parseMinutes } from './digital-draft.js';
import { ItemEditor } from './item-editor.js';
import { sizeLabel } from './digital-fields.js';
import { PHYSICAL_ITEM, PHYSICAL_ROW, type EditorItem, type ItemRow, type ItemsApi } from './store-types.js';

const MB = 1_048_576;
const base: EditorItem = { ...PHYSICAL_ITEM, id: 'a', name: 'Recipe e-book', slug: 'a', category: null, tag: null, sku: null, description: null, photoKey: null, priceCents: 2500, options: [], available: true, photoUrl: null };
const files = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `f${i}`, name: `guide-${i}.pdf`, sizeBytes: 4 * MB }));
const digital = (over: Partial<EditorItem>): EditorItem => ({ ...base, kind: 'DIGITAL', ...over });

const row = (over: Partial<ItemRow> = {}): ItemRow => ({ ...PHYSICAL_ROW, id: 'a', name: 'Recipe e-book', slug: 'a', category: null, tag: null, sku: null, description: null, photoKey: null, available: true, priceCents: 2500, options: [], ...over });

function api(over: Partial<ItemsApi> = {}): ItemsApi {
  return {
    add: vi.fn(async () => row()),
    update: vi.fn(async (_id, patch) => row(patch.kind === 'DIGITAL' ? { kind: 'DIGITAL', delivery: patch.delivery ?? null } : {})),
    remove: vi.fn(async () => undefined),
    reorder: vi.fn(async () => undefined),
    uploadPhoto: vi.fn(),
    removePhoto: vi.fn(),
    uploadFile: vi.fn(async (_id, file, onProgress) => {
      onProgress(0.5);
      return { id: 'new', name: file.name, sizeBytes: file.size };
    }),
    removeFile: vi.fn(async () => undefined),
    addCodes: vi.fn(async () => ({ added: 2, left: 5 })),
    addSession: vi.fn(async (_id, input) => ({ id: 's-new', startsAt: new Date(input.startsAt).toISOString(), seats: input.seats, booked: 0, seatsLeft: input.seats })),
    updateSession: vi.fn(),
    removeSession: vi.fn(async () => undefined),
    ...over,
  };
}

function show(item: EditorItem | null, calls = api()) {
  const props = { onSaved: vi.fn(), onPreview: vi.fn(), onRemoved: vi.fn(), onClose: vi.fn() };
  render(<ItemEditor item={item} tint={0} uploadsEnabled categories={[]} api={calls} {...props} />);
  return { calls, ...props };
}

const pause = () => act(async () => { await vi.advanceTimersByTimeAsync(600); });
const picked = (name: string, size: number, type = 'application/pdf') => {
  const file = new File(['x'], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
};

afterEach(() => vi.useRealTimers());

describe('the Physical / Digital switch', () => {
  it('shows the four ways to get it only for a digital item, and sends the kind and delivery once', async () => {
    vi.useFakeTimers();
    const { calls } = show(base);
    expect(screen.getByRole('radio', { name: 'Physical' })).toBeChecked();
    expect(screen.queryByText('How they get it')).toBeNull();

    fireEvent.click(screen.getByRole('radio', { name: 'Digital' }));
    expect(screen.getByText('How they get it')).toBeInTheDocument();
    expect(screen.getByText('No day, pickup or delivery at checkout')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Files/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /^A session/ })).toBeInTheDocument();
    await pause();
    expect(calls.update).toHaveBeenCalledWith('a', expect.objectContaining({ kind: 'DIGITAL', delivery: 'FILES' }));

    fireEvent.click(screen.getByRole('radio', { name: 'Physical' }));
    expect(screen.queryByText('How they get it')).toBeNull();
    await pause();
    expect(calls.update).toHaveBeenLastCalledWith('a', expect.objectContaining({ kind: 'PHYSICAL' }));
  });

  it('shows the panel of the way picked', () => {
    show(digital({ delivery: 'FILES' }));
    expect(screen.getByText('Upload the files they get')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^A link/ }));
    expect(screen.getByLabelText('Link they get')).toBeInTheDocument();
    expect(screen.queryByText('Upload the files they get')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Codes/ }));
    expect(screen.getByLabelText('Codes, one per line')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^A session/ }));
    expect(screen.getByLabelText('How long')).toBeInTheDocument();
  });

  it('asks for a name and a price before it takes a file', () => {
    show(null);
    fireEvent.click(screen.getByRole('radio', { name: 'Digital' }));
    expect(screen.getByRole('button', { name: /Upload the files they get/ })).toBeDisabled();
  });
});

describe('files', () => {
  it('refuses a 101 MB file before sending a byte, and keeps what was there', async () => {
    const { calls } = show(digital({ delivery: 'FILES', files: files(1) }));
    fireEvent.change(screen.getByLabelText('Files they get'), { target: { files: [picked('big.zip', 101 * MB, 'application/zip')] } });
    expect(await screen.findByText('big.zip is 101 MB. The most for one file is 100 MB.')).toBeInTheDocument();
    expect(calls.uploadFile).not.toHaveBeenCalled();
    expect(screen.getByText('guide-0.pdf')).toBeInTheDocument();
  });

  it('takes exactly 100 MB, shows it going up, and lists it', async () => {
    let finish!: () => void;
    const calls = api({
      uploadFile: vi.fn(
        (_id, file, onProgress) =>
          new Promise<{ id: string; name: string; sizeBytes: number }>((resolve) => {
            onProgress(0.4);
            finish = () => resolve({ id: 'n', name: file.name, sizeBytes: file.size });
          }),
      ),
    });
    show(digital({ delivery: 'FILES' }), calls);
    fireEvent.change(screen.getByLabelText('Files they get'), { target: { files: [picked('video.mp4', 100 * MB, 'video/mp4')] } });
    const bar = await screen.findByRole('progressbar', { name: 'Uploading video.mp4' });
    expect(bar).toHaveAttribute('aria-valuenow', '40');
    await act(async () => finish());
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.getByText('video.mp4')).toBeInTheDocument();
    expect(screen.getByText('100 MB')).toBeInTheDocument();
    expect(calls.uploadFile).toHaveBeenCalledWith('a', expect.any(File), expect.any(Function));
  });

  it('will not take a sixth file', () => {
    show(digital({ delivery: 'FILES', files: files(5) }));
    expect(screen.getByRole('button', { name: /Add another file/ })).toBeDisabled();
  });

  it('refuses a sixth file that arrives together with the others', async () => {
    const { calls } = show(digital({ delivery: 'FILES', files: files(4) }));
    fireEvent.change(screen.getByLabelText('Files they get'), { target: { files: [picked('a.pdf', MB), picked('b.pdf', MB)] } });
    expect(await screen.findByText('5 files is the most an item holds. Remove one to add another.')).toBeInTheDocument();
    expect(calls.uploadFile).toHaveBeenCalledTimes(1);
  });

  it('takes a ZIP the way Windows browsers name it, or with no type at all', async () => {
    const { calls } = show(digital({ delivery: 'FILES' }));
    fireEvent.change(screen.getByLabelText('Files they get'), { target: { files: [picked('pack.zip', MB, 'application/x-zip-compressed'), picked('other.zip', MB, '')] } });
    await act(async () => undefined);
    expect(calls.uploadFile).toHaveBeenCalledTimes(2);
  });

  it('refuses a type the shop cannot hand over', async () => {
    const { calls } = show(digital({ delivery: 'FILES' }));
    fireEvent.change(screen.getByLabelText('Files they get'), { target: { files: [picked('run.exe', MB, 'application/x-msdownload')] } });
    expect(await screen.findByText(/run.exe is not a PDF, image, ZIP, audio or video file/)).toBeInTheDocument();
    expect(calls.uploadFile).not.toHaveBeenCalled();
  });

  it("says the API's reason in place when an upload fails", async () => {
    const calls = api({
      uploadFile: vi.fn(async () => {
        throw new ApiError(409, 'TOO_MANY_FILES', 'An item holds 5 files at most.');
      }),
    });
    show(digital({ delivery: 'FILES' }), calls);
    fireEvent.change(screen.getByLabelText('Files they get'), { target: { files: [picked('a.pdf', MB)] } });
    expect(await screen.findByText('An item holds 5 files at most.')).toBeInTheDocument();
  });

  it('removes a file', async () => {
    const { calls } = show(digital({ delivery: 'FILES', files: files(2) }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove guide-0.pdf' }));
    await act(async () => undefined);
    expect(calls.removeFile).toHaveBeenCalledWith('a', 'f0');
    expect(screen.queryByText('guide-0.pdf')).toBeNull();
    expect(screen.getByText('guide-1.pdf')).toBeInTheDocument();
  });

  it('writes sizes the way the board does', () => {
    expect(sizeLabel(220_000)).toBe('215 KB');
    expect(sizeLabel(Math.round(4.2 * MB))).toBe('4.2 MB');
    expect(sizeLabel(100 * MB)).toBe('100 MB');
  });
});

describe('a link', () => {
  it('sends nothing until the link is https, then sends it with its note', async () => {
    vi.useFakeTimers();
    const { calls } = show(digital({ delivery: 'LINK' }));
    fireEvent.change(screen.getByLabelText('Link they get'), { target: { value: 'http://example.com/x' } });
    await pause();
    expect(calls.update).not.toHaveBeenCalled();
    expect(screen.getAllByText(/has to start with https:\/\//).length).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText('Link they get'), { target: { value: ' https://youtu.be/abc ' } });
    fireEvent.change(screen.getByLabelText('Note with the link'), { target: { value: 'Password is kek' } });
    expect(screen.getByText('15/200')).toBeInTheDocument();
    await pause();
    expect(calls.update).toHaveBeenCalledWith('a', expect.objectContaining({ kind: 'DIGITAL', delivery: 'LINK', accessUrl: 'https://youtu.be/abc', accessNote: 'Password is kek' }));
  });
});

describe('codes', () => {
  it('shows how many are left, and updates it after adding', async () => {
    const { calls } = show(digital({ delivery: 'CODES', codesLeft: 3 }));
    expect(screen.getByText('3 codes')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add codes' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Codes, one per line'), { target: { value: 'AAA\n AAA \n\nBBB\nCCC' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add 3 codes' }));
    await act(async () => undefined);
    expect(calls.addCodes).toHaveBeenCalledWith('a', 'AAA\n AAA \n\nBBB\nCCC');
    expect(screen.getByText('5 codes')).toBeInTheDocument();
    expect(screen.getByText('Added 2. 1 was already there.')).toBeInTheDocument();
    expect(screen.getByLabelText('Codes, one per line')).toHaveValue('');
  });

  it('keeps what was pasted when the API says no', async () => {
    const calls = api({
      addCodes: vi.fn(async () => {
        throw new ApiError(400, 'INVALID_CODES', 'A code is 200 characters at most.');
      }),
    });
    show(digital({ delivery: 'CODES', codesLeft: 0 }), calls);
    fireEvent.change(screen.getByLabelText('Codes, one per line'), { target: { value: 'AAA' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add 1 code' }));
    expect(await screen.findByText('A code is 200 characters at most.')).toBeInTheDocument();
    expect(screen.getByLabelText('Codes, one per line')).toHaveValue('AAA');
  });
});

describe('a session', () => {
  const when = new Date('2030-11-07T12:00:00Z');
  const klass = (sessions: EditorItem['sessions']) => digital({ delivery: 'SESSION', sessionMinutes: 90, sessionPlace: 'ONLINE', sessionWhere: 'meet.google.com/x', sessions });

  it('shows times in Malaysia time, and will not remove one with bookings, saying why', () => {
    show(klass([{ id: 's1', startsAt: when, seats: 12, booked: 7, seatsLeft: 5 }, { id: 's2', startsAt: new Date('2030-11-15T07:00:00Z'), seats: 12, booked: 0, seatsLeft: 12 }]));
    const first = screen.getByRole('group', { name: 'Time: Thu 7 Nov, 8:00pm' });
    expect(within(first).getByLabelText('Date')).toHaveValue('2030-11-07');
    expect(within(first).getByLabelText('Time')).toHaveValue('20:00');
    expect(within(first).getByText('7 booked')).toBeInTheDocument();
    const remove = within(first).getByRole('button', { name: 'Remove this time' });
    expect(remove).toBeDisabled();
    expect(remove).toHaveAttribute('title', '7 booked, so this time cannot be removed');
    expect(within(first).getByLabelText('Date')).toBeDisabled();

    const second = screen.getByRole('group', { name: 'Time: Fri 15 Nov, 3:00pm' });
    expect(within(second).getByRole('button', { name: 'Remove this time' })).toBeEnabled();
  });

  it('adds a time entered in Malaysia time, sent with +08:00', async () => {
    const { calls } = show(klass([{ id: 's1', startsAt: when, seats: 12, booked: 0, seatsLeft: 12 }]));
    fireEvent.click(screen.getByRole('button', { name: '+ Add a time' }));
    fireEvent.change(screen.getByLabelText('New date'), { target: { value: '2030-12-01' } });
    fireEvent.change(screen.getByLabelText('New time'), { target: { value: '15:30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await act(async () => undefined);
    expect(calls.addSession).toHaveBeenCalledWith('a', { startsAt: '2030-12-01T15:30:00+08:00', seats: 12 });
    expect(screen.getByRole('group', { name: 'Time: Sun 1 Dec, 3:30pm' })).toBeInTheDocument();
  });

  it('shows the API reason in place and keeps the form', async () => {
    const calls = api({
      addSession: vi.fn(async () => {
        throw new ApiError(400, 'INVALID_SESSION', 'That time has already passed.');
      }),
    });
    show(klass([]), calls);
    fireEvent.click(screen.getByRole('button', { name: '+ Add a time' }));
    fireEvent.change(screen.getByLabelText('New date'), { target: { value: '2020-01-01' } });
    fireEvent.change(screen.getByLabelText('New time'), { target: { value: '10:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByText('That time has already passed.')).toBeInTheDocument();
    expect(screen.getByLabelText('New date')).toHaveValue('2020-01-01');
  });

  it('changes seats on a booked time but never its hour', async () => {
    const calls = api({ updateSession: vi.fn(async () => ({ id: 's1', startsAt: when.toISOString(), seats: 20, booked: 7, seatsLeft: 13 })) });
    show(klass([{ id: 's1', startsAt: when, seats: 12, booked: 7, seatsLeft: 5 }]), calls);
    fireEvent.change(screen.getByLabelText('Seats'), { target: { value: '20' } });
    fireEvent.blur(screen.getByLabelText('Seats'));
    await act(async () => undefined);
    expect(calls.updateSession).toHaveBeenCalledWith('a', 's1', { seats: 20 });
  });

  it('removes a time with nobody booked', async () => {
    const { calls } = show(klass([{ id: 's1', startsAt: when, seats: 12, booked: 0, seatsLeft: 12 }]));
    fireEvent.click(screen.getByRole('button', { name: 'Remove this time' }));
    await act(async () => undefined);
    expect(calls.removeSession).toHaveBeenCalledWith('a', 's1');
    expect(screen.queryByRole('group', { name: /^Time:/ })).toBeNull();
  });

  it('saves how long and where, and holds the first time back until they are set', async () => {
    vi.useFakeTimers();
    const { calls } = show(base);
    fireEvent.click(screen.getByRole('radio', { name: 'Digital' }));
    fireEvent.click(screen.getByRole('button', { name: /^A session/ }));
    expect(screen.getByRole('button', { name: '+ Add a time' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '+ Add a time' })).toHaveAttribute('title', 'Say how long it runs and where first');
    fireEvent.change(screen.getByLabelText('How long'), { target: { value: '90 minutes' } });
    fireEvent.change(screen.getByLabelText('Meeting link, sent after they pay'), { target: { value: 'meet.google.com/x' } });
    await pause();
    expect(calls.update).toHaveBeenCalledWith('a', expect.objectContaining({ kind: 'DIGITAL', delivery: 'SESSION', sessionMinutes: 90, sessionPlace: 'ONLINE', sessionWhere: 'meet.google.com/x' }));
    fireEvent.click(screen.getByRole('radio', { name: 'In person' }));
    expect(screen.getByLabelText('Where, sent after they pay')).toBeInTheDocument();
  });
});

describe('the digital draft', () => {
  it('reads minutes the way people type them', () => {
    expect(parseMinutes('90')).toBe(90);
    expect(parseMinutes('90 minutes')).toBe(90);
    expect(parseMinutes('1 hour')).toBeNull();
    expect(parseMinutes('0')).toBeNull();
    expect(parseMinutes('1441')).toBeNull();
  });

  it('judges each way on its own fields', () => {
    const d = digitalDraftOf(digital({ delivery: 'FILES' }));
    expect(checkDigital(d)).toEqual({ fields: { kind: 'DIGITAL', delivery: 'FILES' } });
    expect(checkDigital({ ...d, kind: 'PHYSICAL' })).toEqual({ fields: { kind: 'PHYSICAL' } });
    expect('error' in checkDigital({ ...d, delivery: 'LINK', link: 'https://' })).toBe(true);
    expect(checkDigital({ ...d, delivery: 'SESSION', minutes: '60', place: 'IN_PERSON', venue: ' Shah Alam ' })).toEqual({
      fields: { kind: 'DIGITAL', delivery: 'SESSION', sessionMinutes: 60, sessionPlace: 'IN_PERSON', sessionWhere: 'Shah Alam' },
    });
  });
});
