import Link from 'next/link';
import styles from './not-found.module.css';

export default function NotFound() {
  return (
    <main className={styles.page}>
      <h1>Nothing here</h1>
      <p>This address does not exist in the admin.</p>
      <Link href="/">Back to Overview</Link>
    </main>
  );
}
