'use client';

import { useEffect, useState } from 'react';
import { isHexColor } from '@curios/core/bento';
import styles from './curios.module.css';

/** What a half-typed or wrong colour says, the same on every colour row. */
export const COLOUR_ERROR = 'Type a colour as six-digit hex, like 2340c8.';

/**
 * The owner's own colour as hex: a "#" and six digits, anything that is not a hex digit dropped as it
 * is typed. Only a whole colour is passed on (`onColour`, lowercased); until then `onInvalid` is, so
 * the caller says what is wanted and sends nothing. The one control for the button colour and the
 * page colour, so the two look and behave alike. `value` is the colour in force (`#rrggbb`); a change
 * to it from outside (a swatch picked) rewrites what is shown.
 */
export function CustomColour({
  value,
  label,
  onColour,
  onInvalid,
}: {
  value: string;
  label: string;
  onColour: (hex: string) => void;
  onInvalid: () => void;
}) {
  const [text, setText] = useState(value.replace(/^#/, ''));
  useEffect(() => setText(value.replace(/^#/, '')), [value]);
  return (
    <span className={styles.hex}>
      #
      <input
        aria-label={label}
        value={text}
        maxLength={6}
        onChange={(event) => {
          const next = event.target.value.replace(/[^0-9a-f]/gi, '').slice(0, 6);
          setText(next);
          if (isHexColor(`#${next}`)) onColour(`#${next.toLowerCase()}`);
          else onInvalid();
        }}
      />
    </span>
  );
}
