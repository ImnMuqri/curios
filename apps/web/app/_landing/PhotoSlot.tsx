import styles from './photo-slot.module.css';

/**
 * Where a photograph goes. Given `src`, the photograph itself, cropped to the
 * slot's frame round `focus`. Without it, visibly a placeholder on purpose --
 * a dashed frame naming the shot it is waiting for -- so it can never be
 * mistaken for the finished page, and nobody ships a stock photo by accident.
 * Every slot is listed in README.md under "Swap in real assets".
 */
export function PhotoSlot({
  shot,
  ratio,
  className,
  src,
  alt,
  focus,
  priority = false,
}: {
  /** What the photograph should show, in plain words. */
  shot: string;
  /** Width / height, e.g. 4 / 5. Leave out to size it from the stylesheet instead. */
  ratio?: number;
  className?: string;
  /** The photograph, once there is one (public/landing). */
  src?: string;
  /** What it shows, for someone who cannot see it. */
  alt?: string;
  /** Where the crop centres, as CSS object-position: the slot's frame is rarely the photo's shape. */
  focus?: string;
  /** Above the fold: load it first rather than lazily. */
  priority?: boolean;
}) {
  if (src) {
    return (
      <div
        className={[styles.slot, styles.filled, className].filter(Boolean).join(' ')}
        style={ratio ? { aspectRatio: String(ratio) } : undefined}
      >
        <img
          src={src}
          alt={alt ?? ''}
          className={styles.image}
          style={focus ? { objectPosition: focus } : undefined}
          loading={priority ? 'eager' : 'lazy'}
          fetchPriority={priority ? 'high' : undefined}
          decoding="async"
        />
      </div>
    );
  }

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
