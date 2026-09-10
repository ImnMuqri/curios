import styles from './Nav.module.css';

/**
 * The row of links between the dashboard's four screens.
 *
 * `current` is a prop, not something read from the router: this package does
 * not import Next, which is what lets it render in a plain vitest jsdom. The
 * layout knows the pathname; this component only needs to be told.
 */
export function Nav({
  items,
  current,
}: {
  items: { href: string; label: string }[];
  current?: string;
}) {
  return (
    <nav className={styles.nav}>
      {items.map((item) => {
        const isCurrent = item.href === current;
        return (
          <a
            key={item.href}
            href={item.href}
            className={styles.link}
            aria-current={isCurrent ? 'page' : undefined}
          >
            {item.label}
          </a>
        );
      })}
    </nav>
  );
}
