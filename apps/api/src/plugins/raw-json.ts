import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

declare module 'fastify' {
  interface FastifyRequest {
    /** The body exactly as received, set only in a scope that registered `rawJson`. */
    rawBody?: string;
  }
}

/**
 * Keeps the bytes of a JSON body as well as the parse of it. CHIP signs the bytes it
 * sends, and a signature can only be checked against those -- a re-serialised parse
 * differs in whitespace and key order. Replaces the JSON parser of the scope it is
 * registered in, so register it only where a route needs it: every other route keeps
 * Fastify's own parser and pays nothing.
 */
export const rawJson = fp(async (app: FastifyInstance) => {
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (request, body, done) => {
    request.rawBody = body as string;
    try {
      done(null, JSON.parse(body as string));
    } catch {
      done(Object.assign(new Error('Body is not valid JSON.'), { statusCode: 400 }), undefined);
    }
  });
});
