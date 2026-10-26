/**
 * What an error-tracking service is told when a process logs at error level or above. Kept free of
 * any SDK: the API and the workers each hand in their own `capture`, and both get the same rules.
 *
 * Every `log.error` in this codebase was written to be read by a person -- a renewal paid at CHIP
 * but not granted, a job that failed, a 500 -- so reporting the log line is how all of them reach
 * someone, with nothing to remember at each call site.
 */
export type ReportedError = {
  /** The logged `err`, when it was an Error: reported as an exception, with its stack. */
  error: Error | null;
  message: string;
  /** The log line's other fields, flat: strings, numbers and booleans only. */
  extra: Record<string, string | number | boolean>;
};

/** pino's numeric level for `error`; `fatal` is above it. */
const ERROR_LEVEL = 50;

/**
 * An order link's token is that order's only credential, and it rides in the path: the API's
 * `/store/orders/<token>` and the web's `/<handle>/order/<token>`. Masked anywhere in a string.
 */
export function maskOrderTokens(text: string): string {
  return text.replace(/(\/store\/orders\/|\/order\/)[^/?#\s"']+/g, '$1:token');
}

/**
 * Only flat values travel, so a request, a reply or a Prisma error object (which can carry the row
 * it failed on) never does. `req` is the one object kept, as its method and masked URL.
 */
function flatten(fields: Record<string, unknown>): ReportedError['extra'] {
  const extra: ReportedError['extra'] = {};
  for (const [key, value] of Object.entries(fields)) {
    // An Error is the report itself, not a field of it.
    if (key === 'err' && value instanceof Error) continue;
    if (typeof value === 'string') extra[key] = maskOrderTokens(value);
    else if (typeof value === 'number' || typeof value === 'boolean') extra[key] = value;
    else if (key === 'req' && value && typeof value === 'object') {
      const req = value as { method?: unknown; url?: unknown };
      if (typeof req.method === 'string') extra.method = req.method;
      if (typeof req.url === 'string') extra.url = maskOrderTokens(req.url);
    }
  }
  return extra;
}

/** Turns one pino call's arguments into what is reported. */
export function reportedError(args: unknown[]): ReportedError {
  const [first, second] = args;
  if (first instanceof Error) {
    return { error: first, message: typeof second === 'string' ? second : first.message, extra: {} };
  }
  if (first && typeof first === 'object') {
    const fields = first as Record<string, unknown>;
    const err = fields.err instanceof Error ? fields.err : null;
    // A logged err that is only a string (`err: error.message`, the pattern here) still travels, masked.
    const message = typeof second === 'string' ? second : (err?.message ?? 'error');
    return { error: err, message: maskOrderTokens(message), extra: flatten(fields) };
  }
  return { error: null, message: maskOrderTokens(typeof first === 'string' ? first : 'error'), extra: {} };
}

/**
 * pino's `hooks.logMethod`, reporting each error-level line through `capture` and logging it as
 * before. A capture that throws is swallowed: error tracking must never take a log line down.
 */
export function errorReportingHook(capture: (report: ReportedError) => void) {
  return function logMethod(this: unknown, args: unknown[], method: (...args: unknown[]) => void, level: number): void {
    if (level >= ERROR_LEVEL) {
      try {
        capture(reportedError(args));
      } catch {
        // Nothing to do: the log line below still goes out.
      }
    }
    method.apply(this, args);
  };
}

type ScrubbableEvent = {
  message?: string;
  exception?: { values?: { value?: string }[] };
  request?: { url?: string; cookies?: unknown; headers?: unknown; data?: unknown; query_string?: unknown };
};

/**
 * An error-tracking event as it may leave the process: order tokens masked in its message, each
 * exception's message and the URL, and no cookies, headers, body or query string, any of which can
 * hold a session, a token or a buyer.
 */
export function scrubEvent<E extends ScrubbableEvent>(event: E): E {
  if (event.message) event.message = maskOrderTokens(event.message);
  for (const exception of event.exception?.values ?? []) {
    if (exception.value) exception.value = maskOrderTokens(exception.value);
  }
  if (event.request) {
    if (event.request.url) event.request.url = maskOrderTokens(event.request.url);
    delete event.request.cookies;
    delete event.request.headers;
    delete event.request.data;
    delete event.request.query_string;
  }
  return event;
}

type ScrubbableBreadcrumb = { message?: string; data?: { [key: string]: unknown } };

/** Every string in `value`, however deep, with order tokens masked; anything past a few levels is dropped. */
function maskDeep(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return maskOrderTokens(value);
  // An Error's message and stack are not its own enumerable fields, so they are read by name.
  if (value instanceof Error) return { name: value.name, message: maskOrderTokens(value.message), stack: value.stack && maskOrderTokens(value.stack) };
  if (depth > 4 || value === null || typeof value !== 'object') return depth > 4 ? undefined : value;
  if (Array.isArray(value)) return value.map((item) => maskDeep(item, depth + 1));
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, maskDeep(item, depth + 1)]));
}

/**
 * A breadcrumb with order tokens masked in its message and anywhere in its data: an outgoing
 * request's URL, or a console line's arguments, which can be a whole logged Error.
 */
export function scrubBreadcrumb<B extends ScrubbableBreadcrumb>(crumb: B): B {
  if (crumb.message) crumb.message = maskOrderTokens(crumb.message);
  if (crumb.data) crumb.data = maskDeep(crumb.data) as B['data'];
  return crumb;
}
