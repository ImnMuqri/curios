import styles from './photo-slot.module.css';

/**
 * Where a real photograph goes. Visibly a placeholder on purpose -- a dashed
 * frame naming the shot it is waiting for -- so it can never be mistaken for
 * the finished page, and nobody ships a stock photo by accident.
 *
 * SWAP: replace with next/image at the same aspect ratio, e.g.
 *   <Image src={...} alt="..." width={1200} height={1500} className={...} />
 * Every slot is listed in README.md under "Swap in real assets".
 */
export function PhotoSlot({
  shot,
  ratio,
  className,
}: {
  /** What the photograph should show, in plain words. */
  shot: string;
  /** Width / height, e.g. 4 / 5. Leave out to size it from the stylesheet instead. */
  ratio?: number;
  className?: string;
}) {
  return (
    <div
      className={[styles.slot, className].filter(Boolean).join(' ')}
      style={ratio ? ({ aspectRatio: String(ratio) }) : undefined}
      role="img"
      aria-label={`Photo to come: ${shot}`}
      data-placeholder="photo"
    >
      <p className={styles.label} aria-hidden="true">
        <span className={styles.kind}>Photo to come</span>
        {shot}
      </p>
    </div>
  );
}
