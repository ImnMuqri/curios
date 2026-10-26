import { describe, expect, it, vi } from 'vitest';
import { errorReportingHook, maskOrderTokens, reportedError, scrubBreadcrumb, scrubEvent } from './error-report.js';

describe('maskOrderTokens', () => {
  it('masks an order token in the API path, the web path and a full URL', () => {
    expect(maskOrderTokens('/store/orders/abcDEF123_-x/files/f1')).toBe('/store/orders/:token/files/f1');
    expect(maskOrderTokens('https://curios.my/keklina/order/abcDEF123?paid=1')).toBe('https://curios.my/keklina/order/:token?paid=1');
    expect(maskOrderTokens('GET /store/orders/zzz and /keklina/order/yyy')).toBe('GET /store/orders/:token and /keklina/order/:token');
  });

  it('leaves the owner’s own order screen alone', () => {
    expect(maskOrderTokens('/app/orders?order=o1')).toBe('/app/orders?order=o1');
  });
});

describe('reportedError', () => {
  it('reports a logged Error with its message, and keeps only flat fields', () => {
    const err = new Error('connect ECONNREFUSED');
    const report = reportedError([{ err, pageId: 'p1', attempt: 2, ok: false, row: { phone: '+60123456789' } }, 'billing job failed']);
    expect(report).toEqual({ error: err, message: 'billing job failed', extra: { pageId: 'p1', attempt: 2, ok: false } });
  });

  it('keeps a request as its method and masked URL, nothing else of it', () => {
    const report = reportedError([{ req: { method: 'GET', url: '/store/orders/secret', headers: { cookie: 'curios_session=x' } } }, 'request failed']);
    expect(report.extra).toEqual({ method: 'GET', url: '/store/orders/:token' });
  });

  it('reports a string err as a field, masked, when there is no Error', () => {
    const report = reportedError([{ err: 'fetch /store/orders/abc failed', jobId: 'j1' }, 'mail failed']);
    expect(report).toEqual({ error: null, message: 'mail failed', extra: { err: 'fetch /store/orders/:token failed', jobId: 'j1' } });
  });

  it('copes with an Error alone and a bare message', () => {
    const err = new Error('boom');
    expect(reportedError([err])).toEqual({ error: err, message: 'boom', extra: {} });
    expect(reportedError(['shutdown failed'])).toEqual({ error: null, message: 'shutdown failed', extra: {} });
  });
});

describe('errorReportingHook', () => {
  it('reports error and fatal lines, not warnings, and always logs the line', () => {
    const capture = vi.fn();
    const method = vi.fn();
    const hook = errorReportingHook(capture);
    hook([{ pageId: 'p1' }, 'renewal paid at CHIP but not granted'], method, 50);
    hook(['slow'], method, 40);
    hook(['dying'], method, 60);
    expect(capture).toHaveBeenCalledTimes(2);
    expect(capture.mock.calls[0]![0]).toMatchObject({ message: 'renewal paid at CHIP but not granted', extra: { pageId: 'p1' } });
    expect(method).toHaveBeenCalledTimes(3);
  });

  it('still logs when reporting throws', () => {
    const method = vi.fn();
    errorReportingHook(() => {
      throw new Error('sentry down');
    })(['x'], method, 50);
    expect(method).toHaveBeenCalledWith('x');
  });
});

describe('scrubEvent and scrubBreadcrumb', () => {
  it('masks the URL and drops cookies, headers, body and query string', () => {
    const event = scrubEvent({ request: { url: 'https://api.curios.my/store/orders/tok/receipt', cookies: { curios_session: 'x' }, headers: { cookie: 'x' }, data: '{"phone":"+60123456789"}', query_string: 't=1' } });
    expect(event).toEqual({ request: { url: 'https://api.curios.my/store/orders/:token/receipt' } });
  });

  it('masks order tokens in the message and in each exception’s message', () => {
    const event = scrubEvent({ message: 'at /store/orders/tok', exception: { values: [{ value: 'boom at /store/orders/tok' }, {}] } });
    expect(event).toEqual({ message: 'at /store/orders/:token', exception: { values: [{ value: 'boom at /store/orders/:token' }, {}] } });
  });

  it('leaves an event with no request as it was', () => {
    expect(scrubEvent({ message: 'x' } as { message: string; request?: undefined })).toEqual({ message: 'x' });
  });

  it('masks a token anywhere in a console breadcrumb’s arguments', () => {
    const crumb = scrubBreadcrumb({ data: { arguments: [' x', { message: 'at /keklina/order/tok', stack: 'Error: at /keklina/order/tok at f' }] } });
    expect(JSON.stringify(crumb)).not.toContain('/order/tok');
    expect(crumb.data).toEqual({ arguments: [' x', { message: 'at /keklina/order/:token', stack: 'Error: at /keklina/order/:token at f' }] });
  });

  it('masks a logged Error inside a breadcrumb, whose message and stack are not enumerable', () => {
    const crumb = scrubBreadcrumb({ data: { arguments: [new Error('at /keklina/order/tok')] } });
    expect(JSON.stringify(crumb)).not.toContain('/order/tok');
    expect(JSON.stringify(crumb)).toContain('at /keklina/order/:token');
  });

  it('masks a breadcrumb’s URL and message', () => {
    expect(scrubBreadcrumb({ message: 'GET /keklina/order/tok', data: { url: 'https://curios.my/keklina/order/tok', status_code: 200 } })).toEqual({
      message: 'GET /keklina/order/:token',
      data: { url: 'https://curios.my/keklina/order/:token', status_code: 200 },
    });
  });
});
