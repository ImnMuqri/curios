import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AskBar } from './ask-bar.js';

/**
 * A hand-rolled reader that yields the given byte chunks one at a time, so
 * tests control exactly where a chunk boundary falls -- mid-event, mid-JSON,
 * or mid-UTF-8-character. Using a real ReadableStream would leave that to
 * the runtime's internal buffering.
 */
function fakeReader(chunks: Uint8Array[]) {
  let i = 0;
  return {
    async read() {
      if (i < chunks.length) {
        const value = chunks[i];
        i += 1;
        return { done: false, value };
      }
      return { done: true, value: undefined };
    },
  };
}

function sseEvent(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function mockOkResponse(chunks: Uint8Array[]) {
  return {
    ok: true,
    status: 200,
    body: { getReader: () => fakeReader(chunks) },
  } as unknown as Response;
}

function submit(question = 'What time do you open?') {
  const input = screen.getByLabelText(/ask a question/i);
  fireEvent.change(input, { target: { value: question } });
  fireEvent.submit(input.closest('form')!);
}

describe('AskBar ask()', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders an SSE event whose data line is split across a chunk boundary', async () => {
    const encoder = new TextEncoder();
    const full = sseEvent({ type: 'text', text: 'Kek 1kg butter starts at RM95' });
    const splitPoint = 25; // lands inside the JSON payload, not on a line break
    const bytes = encoder.encode(full);
    const chunks = [bytes.slice(0, splitPoint), bytes.slice(splitPoint)];

    vi.mocked(fetch).mockResolvedValue(mockOkResponse(chunks));

    render(<AskBar handle="nadia" questions={['a', 'b']} />);
    submit();

    await waitFor(() => {
      expect(screen.getByText('Kek 1kg butter starts at RM95')).toBeDefined();
    });
  });

  it('skips a malformed data line mid-stream and still renders the valid event that follows', async () => {
    const encoder = new TextEncoder();
    const malformed = 'data: {not valid json\n\n';
    const valid = sseEvent({ type: 'text', text: 'Open Monday to Saturday' });

    vi.mocked(fetch).mockResolvedValue(
      mockOkResponse([encoder.encode(malformed), encoder.encode(valid)]),
    );

    render(<AskBar handle="nadia" questions={['a', 'b']} />);
    submit();

    await waitFor(() => {
      expect(screen.getByText('Open Monday to Saturday')).toBeDefined();
    });
  });

  it('shows a visible error and never touches the reader on a non-ok response', async () => {
    const getReader = vi.fn();
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
      body: { getReader },
    } as unknown as Response);

    render(<AskBar handle="nadia" questions={['a', 'b']} />);
    submit();

    await waitFor(() => {
      expect(screen.getByText('That answer failed. Try again.')).toBeDefined();
    });
    expect(getReader).not.toHaveBeenCalled();
  });

  it('renders a multi-byte character split across a chunk boundary intact', async () => {
    const encoder = new TextEncoder();
    const text = '你好';
    const full = sseEvent({ type: 'text', text });
    const bytes = encoder.encode(full);
    const prefixLength = encoder.encode(full.slice(0, full.indexOf(text))).length;
    // Split one byte into the three-byte UTF-8 encoding of the first character.
    const splitPoint = prefixLength + 1;
    const chunks = [bytes.slice(0, splitPoint), bytes.slice(splitPoint)];

    vi.mocked(fetch).mockResolvedValue(mockOkResponse(chunks));

    render(<AskBar handle="nadia" questions={['a', 'b']} />);
    submit();

    await waitFor(() => {
      expect(screen.getByText(text)).toBeDefined();
    });
  });
});
