import Link from 'next/link';
import inbox from './inbox.module.css';

/**
 * The pages to number: all of them up to seven, otherwise the first, the last,
 * and the ones around the current page, with null for each gap between.
 */
export function pageList(page: number, pages: number): (number | null)[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  // Near either end, five in a row, so the list keeps one length as you move.
  const from = page <= 4 ? 2 : page >= pages - 3 ? pages - 4 : page - 1;
  const to = page <= 4 ? 5 : page >= pages - 3 ? pages - 1 : page + 1;
  const middle = Array.from({ length: to - from + 1 }, (_, i) => from + i);
  return [1, from > 2 ? null : [], middle, to < pages - 1 ? null : [], pages].flat();
}

/** Previous, the page numbers, and Next, each a link made by `href`. Nothing when there is one page. */
export function Pager({ page, pages, href, label }: { page: number; pages: number; href: (page: number) => string; label: string }) {
  if (pages <= 1) return null;
  return (
    <nav className={inbox.pager} aria-label={label} data-numbered="">
      {page > 1 ? <Link href={href(page - 1)}>Previous</Link> : <span aria-hidden="true">Previous</span>}
      <ol className={inbox.pages}>
        {pageList(page, pages).map((n, i) => (
          <li key={n ?? `gap-${i}`}>
            {n === null ? (
              <span data-gap="" aria-hidden="true">
                …
              </span>
            ) : n === page ? (
              <span aria-current="page" aria-label={`Page ${n} of ${pages}`}>
                {n}
              </span>
            ) : (
              <Link href={href(n)} aria-label={`Page ${n}`}>
                {n}
              </Link>
            )}
          </li>
        ))}
      </ol>
      {page < pages ? <Link href={href(page + 1)}>Next</Link> : <span aria-hidden="true">Next</span>}
    </nav>
  );
}
