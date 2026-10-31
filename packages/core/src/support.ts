import { randomUUID } from "node:crypto";

// Pure rules shared by the support worker, the admin API and their tests. Not
// re-exported from index.ts: that is bundled into client components and this
// file needs node:crypto.

export function supportAddress(
  env: Record<string, string | undefined> = process.env,
): string {
  return (env.SUPPORT_EMAIL ?? "").trim().toLowerCase() || "support@curios.my";
}

export function parseAddress(raw: string): {
  address: string;
  name: string | null;
} {
  const s = raw.trim();
  const m = /^(.*?)<([^<>]*)>\s*$/.exec(s);
  if (!m) return { address: s.toLowerCase(), name: null };
  const name = m[1]!
    .trim()
    .replace(/^"(.*)"$/, "$1")
    .trim();
  return { address: m[2]!.trim().toLowerCase(), name: name || null };
}

export function isForSupport(
  lists: { to?: string[]; cc?: string[]; received_for?: string[] },
  support: string,
): boolean {
  const want = support.trim().toLowerCase();
  return [
    ...(lists.to ?? []),
    ...(lists.cc ?? []),
    ...(lists.received_for ?? []),
  ].some((a) => parseAddress(a).address === want);
}

export function replySubject(subject: string): string {
  const s = subject.trim();
  if (!s) return "Re: (no subject)";
  return /^re:/i.test(s) ? s : `Re: ${s}`;
}

export function threadingIds(
  headers: Record<string, string | string[] | undefined>,
): string[] {
  const byName = new Map<string, string | string[] | undefined>();
  for (const [k, v] of Object.entries(headers)) byName.set(k.toLowerCase(), v);
  const ids: string[] = [];
  for (const name of ["in-reply-to", "references"]) {
    const v = byName.get(name);
    const text = Array.isArray(v) ? v.join(" ") : (v ?? "");
    ids.push(...text.split(/\s+/).filter(Boolean));
  }
  return [...new Set(ids)];
}

// The References header keeps growing with a thread; mail clients only need the tail.
export function referencesFor(messageIds: string[]): string[] {
  return [...new Set(messageIds)].slice(-20);
}

export function newMessageId(domain = "curios.my"): string {
  return `<${randomUUID()}@${domain}>`;
}

// Resend's received-email `authentication` is `{ spf, dkim, dmarc } | null`, each a plain
// string: 'pass' | 'fail' | 'gray' | 'processing_failed' | 'unknown'; null on older mail.
// Source: https://resend.com/docs/api-reference/emails/retrieve-received-email
// Anything else is treated as not spam: never hide mail on a shape we did not expect.
export function isSpam(auth: unknown): boolean {
  if (!auth || typeof auth !== "object") return false;
  const { spf, dkim, dmarc } = auth as Record<string, unknown>;
  if (dmarc === "fail") return true;
  return (
    (dmarc === undefined || dmarc === "unknown") &&
    spf === "fail" &&
    dkim === "fail"
  );
}
