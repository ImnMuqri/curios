'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import ui from '../_ui/editor.module.css';
import { bankFor, banksMatching, type Bank } from './banks.js';
import styles from './store.module.css';

/**
 * The bank name as a combobox: every bank in Malaysia with its logo (banks.ts), narrowed as the owner
 * types. Picking one writes the name people know it by. A bank not listed can still be typed, as the
 * field always took, so a shop saved before the list keeps its name.
 */
export function BankPicker({ value, onChange, maxLength }: { value: string; onChange: (text: string) => void; maxLength: number }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const chosen = bankFor(value);
  const options = banksMatching(value);
  const activeBank = open ? options[active] : undefined;

  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);

  // The active option stays in view as the arrow keys move through a long list.
  useEffect(() => {
    if (activeBank) list.current?.querySelector(`[data-bank="${activeBank.id}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [activeBank]);

  const show = () => {
    setActive(Math.max(0, options.findIndex((b) => b.id === chosen?.id)));
    setOpen(true);
  };
  const pick = (bank: Bank) => {
    onChange(bank.name);
    setOpen(false);
  };

  const key = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) return show();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((at) => (at + step + options.length) % options.length);
    } else if (event.key === 'Enter' && activeBank) {
      event.preventDefault();
      pick(activeBank);
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      setOpen(false);
    } else if (event.key === 'Tab') {
      setOpen(false);
    }
  };

  return (
    <div ref={root} className={styles.bankPicker}>
      <label className={`${ui.float} ${styles.bankField}`} data-logo={chosen ? '' : undefined}>
        <em>Bank name</em>
        {chosen ? <img className={styles.bankLogo} src={chosen.logo} alt="" width={22} height={22} /> : null}
        <input
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-banks`}
          aria-autocomplete="list"
          aria-activedescendant={activeBank ? `${id}-${activeBank.id}` : undefined}
          value={value}
          maxLength={maxLength}
          placeholder="Search for your bank"
          autoComplete="off"
          onFocus={show}
          onClick={() => !open && show()}
          onChange={(event) => {
            onChange(event.target.value);
            setActive(0);
            setOpen(true);
          }}
          // Typed the way a listed bank is known ("maybank"), it is saved as its name.
          onBlur={() => chosen && chosen.name !== value && onChange(chosen.name)}
          onKeyDown={key}
        />
        <svg className={styles.bankChevron} viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </label>
      {open && options.length > 0 ? (
        <ul ref={list} id={`${id}-banks`} role="listbox" aria-label="Banks" className={styles.bankList}>
          {options.map((bank, i) => (
            <li
              key={bank.id}
              id={`${id}-${bank.id}`}
              data-bank={bank.id}
              role="option"
              aria-selected={chosen?.id === bank.id}
              data-active={i === active ? '' : undefined}
              // Keep the focus in the field, so picking does not blur it first.
              onPointerDown={(event) => event.preventDefault()}
              onPointerEnter={() => setActive(i)}
              onClick={() => pick(bank)}
            >
              <img src={bank.logo} alt="" width={22} height={22} loading="lazy" />
              {bank.name}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
