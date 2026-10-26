import { preconnect, prefetchDNS } from 'react-dom';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

/**
 * Every page: look up the API's name ahead of the first call, the cheapest
 * hint there is. A full connection on every page would be wasted on most
 * landing-page visits, which never call the API.
 */
export function lookUpApi(): void {
  prefetchDNS(API);
}

/**
 * A page that calls the API the moment someone acts (signing in, signing up):
 * open the connection while they type. Credentialed, as apiFetch's requests
 * are. A browser keeps credentialed and anonymous connections apart, so an
 * anonymous preconnect would go unused.
 */
export function connectToApi(): void {
  preconnect(API, { crossOrigin: 'use-credentials' });
}
