/** The Curios team has suspended this page: nothing a visitor does to it works until it is brought back. */
export class PageUnavailableError extends Error {
  readonly statusCode = 410;
  readonly code = 'PAGE_UNAVAILABLE';
  constructor() {
    super('This page is unavailable.');
    this.name = 'PageUnavailableError';
  }
}
