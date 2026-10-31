import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';

/**
 * Resend's received-email API, the two calls the support worker needs:
 * - GET /emails/receiving/{id} (https://resend.com/docs/api-reference/emails/retrieve-received-email)
 * - GET /emails/receiving/{email_id}/attachments/{id}
 *   (https://resend.com/docs/api-reference/emails/retrieve-received-email-attachment), whose
 *   `download_url` is a signed CDN link, valid for an hour, fetched without the API key.
 */

export interface ReceivedAttachment {
  id: string;
  filename: string;
  content_type: string;
  content_disposition: string | null;
  content_id: string | null;
  size: number;
}

/** The fields of a received email the worker reads; Resend sends more. */
export interface ReceivedEmail {
  from: string;
  to: string[];
  cc: string[];
  reply_to: string[];
  /** The `for` clauses of the Received headers: where a Bcc'd copy shows it was for us. */
  received_for?: string[];
  subject: string | null;
  html: string | null;
  text: string | null;
  headers: Record<string, string | string[]>;
  message_id: string | null;
  /** `{ spf, dkim, dmarc }` or null; read only by isSpam. */
  authentication: unknown;
  attachments: ReceivedAttachment[];
}

export interface ResendClient {
  getReceived: (id: string) => Promise<ReceivedEmail>;
  attachmentStream: (emailId: string, attachmentId: string) => Promise<{ stream: NodeJS.ReadableStream; contentType: string; size: number }>;
}

type Fetch = (url: string, init?: { headers?: Record<string, string> }) => Promise<Response>;

export function createResendClient({
  apiKey,
  baseUrl = 'https://api.resend.com',
  fetch = globalThis.fetch,
}: {
  apiKey: string;
  baseUrl?: string;
  fetch?: Fetch;
}): ResendClient {
  // The status only: Resend's error body could quote the email back.
  const ok = (response: Response, what: string) => {
    if (!response.ok) throw new Error(`Resend ${what} answered ${response.status}`);
    return response;
  };
  const get = async <T>(path: string, what: string): Promise<T> => {
    const response = ok(await fetch(`${baseUrl}${path}`, { headers: { Authorization: `Bearer ${apiKey}` } }), what);
    return (await response.json()) as T;
  };

  return {
    // cid, so inline images stay references to their attachments rather than base64 inside the html.
    getReceived: (id) => get<ReceivedEmail>(`/emails/receiving/${encodeURIComponent(id)}?html_format=cid`, 'email'),
    async attachmentStream(emailId, attachmentId) {
      const meta = await get<{ content_type: string; size: number; download_url: string }>(
        `/emails/receiving/${encodeURIComponent(emailId)}/attachments/${encodeURIComponent(attachmentId)}`,
        'attachment',
      );
      const download = ok(await fetch(meta.download_url), 'attachment download');
      if (!download.body) throw new Error('Resend attachment download had no body');
      return {
        stream: Readable.fromWeb(download.body as WebReadableStream<Uint8Array>),
        contentType: meta.content_type,
        size: meta.size,
      };
    },
  };
}
