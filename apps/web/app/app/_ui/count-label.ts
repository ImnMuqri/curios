/** A count as a chip shows it: past 99 it reads "99+" (the calm boards, everywhere a count sits). */
export function countLabel(count: number): string {
  return count > 99 ? '99+' : String(count);
}
