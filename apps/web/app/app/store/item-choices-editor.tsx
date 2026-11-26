'use client';

import type { CSSProperties, KeyboardEvent } from 'react';
import { CHOICE_LABEL_MAX, CHOICE_NAME_MAX, MAX_CHOICES } from '@curios/core/store';
import ui from '../_ui/editor.module.css';
import { addGroupTwo, blankChoice, cellKey, cellOf, dropGroupTwo, setSame, type CellDraft, type ChoiceDraft, type ChoicesDraft } from './pricing.js';
import type { OwnerPhoto } from './store-types.js';
import styles from './item-choices.module.css';

const BIN = 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6';

/**
 * The Options price, in one or two named groups: Group one and Group two with their choices, then a
 * price for every combination. Wide: rows are group one, columns group two. On a phone each group-one
 * choice stacks its group-two prices under it. A group-one choice can pick one of the item's photos.
 */
export function ItemChoicesEditor({
  draft,
  onChange,
  photos,
  photoUrl,
}: {
  draft: ChoicesDraft;
  onChange: (next: ChoicesDraft) => void;
  /** The item's own photos: a choice's picture can only be one of these. */
  photos: OwnerPhoto[];
  photoUrl: (key: string) => string;
}) {
  const { one, two } = draft;
  const nameOne = draft.nameOne.trim() || 'group one';
  const nameTwo = draft.nameTwo.trim() || 'group two';
  const labelOf = (choice: ChoiceDraft, index: number, group: string) => choice.label.trim() || `${group} choice ${index + 1}`;

  const setCell = (oneKey: number | '*', twoKey: number | null, change: Partial<CellDraft>) => {
    const key = cellKey(oneKey, twoKey);
    const current = draft.cells[key] ?? { price: '', available: true };
    onChange({ ...draft, cells: { ...draft.cells, [key]: { ...current, ...change } } });
  };
  const edit = (which: 'one' | 'two', key: number, change: Partial<ChoiceDraft>) =>
    onChange({ ...draft, [which]: (draft[which] ?? []).map((choice) => (choice.key === key ? { ...choice, ...change } : choice)) });
  const remove = (which: 'one' | 'two', key: number) => onChange({ ...draft, [which]: (draft[which] ?? []).filter((choice) => choice.key !== key) });
  const add = (which: 'one' | 'two') => onChange({ ...draft, [which]: [...(draft[which] ?? []), blankChoice()] });

  /** The photo a choice shows as picked: one the item no longer has counts as none. */
  const pickedOf = (choice: ChoiceDraft, items: OwnerPhoto[]) => (items.some((photo) => photo.id === choice.photoId) ? choice.photoId : null);
  /** Arrow keys move through "No photo" and the photos, picking as they go; one tab stop for the whole row. */
  const pickKey = (event: KeyboardEvent<HTMLDivElement>, choice: ChoiceDraft, items: OwnerPhoto[]) => {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const ids = [null, ...items.map((photo) => photo.id)];
    const at = ids.indexOf(pickedOf(choice, items));
    const next = (at + step + ids.length) % ids.length;
    edit('one', choice.key, { photoId: ids[next] ?? null });
    event.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus();
  };

  const group = (which: 'one' | 'two') => {
    const choices = (which === 'one' ? one : two) ?? [];
    const title = which === 'one' ? 'Group one' : 'Group two';
    const name = which === 'one' ? draft.nameOne : draft.nameTwo;
    return (
      <fieldset className={styles.group}>
        <legend>{title}</legend>
        <input
          className={styles.name}
          value={name}
          maxLength={CHOICE_NAME_MAX * 2}
          placeholder={which === 'one' ? 'Group name, like Flavour' : 'Group name, like Size'}
          aria-label={`${title} name`}
          autoComplete="off"
          onChange={(event) => onChange({ ...draft, [which === 'one' ? 'nameOne' : 'nameTwo']: event.target.value })}
        />
        <div className={styles.choices}>
          {choices.map((choice, index) => (
            <div key={choice.key} className={styles.choice}>
              <input
                className={styles.label}
                value={choice.label}
                maxLength={CHOICE_LABEL_MAX * 2}
                placeholder={`Choice ${index + 1}`}
                aria-label={`${title} choice ${index + 1} name`}
                autoComplete="off"
                onChange={(event) => edit(which, choice.key, { label: event.target.value })}
              />
              {/* No photos on the item yet: just the hint below, not a row of empty pickers. */}
              {which === 'one' && photos.length > 0 ? (
                <div className={styles.pick} role="radiogroup" aria-label={`Photo for ${labelOf(choice, index, 'group one')}`} onKeyDown={(event) => pickKey(event, choice, photos)}>
                  <button type="button" role="radio" aria-checked={pickedOf(choice, photos) === null} tabIndex={pickedOf(choice, photos) === null ? 0 : -1} aria-label="No photo" className={styles.none} onClick={() => edit('one', choice.key, { photoId: null })}>
                    <span aria-hidden="true">–</span>
                  </button>
                  {photos.map((photo, n) => (
                    <button key={photo.id} type="button" role="radio" aria-checked={pickedOf(choice, photos) === photo.id} tabIndex={pickedOf(choice, photos) === photo.id ? 0 : -1} aria-label={`Photo ${n + 1}`} className={styles.square} onClick={() => edit('one', choice.key, { photoId: photo.id })}>
                      {/* eslint-disable-next-line @next/next/no-img-element -- a 512px square the item already shows */}
                      <img src={photoUrl(photo.squareKey)} alt="" />
                    </button>
                  ))}
                </div>
              ) : null}
              <button type="button" className={ui.iconButton} aria-label={`Remove ${labelOf(choice, index, which === 'one' ? 'group one' : 'group two')} from ${which === 'one' ? nameOne : nameTwo}`} disabled={choices.length === 1} onClick={() => remove(which, choice.key)}>
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" className={ui.toolIcon}>
                  <path d={BIN} />
                </svg>
              </button>
            </div>
          ))}
        </div>
        {which === 'one' && photos.length === 0 ? <p className={ui.note}>Add photos above to pick one per {nameOne}.</p> : null}
        {choices.length < MAX_CHOICES ? (
          <button type="button" className={ui.addRow} onClick={() => add(which)}>
            + Add a choice
          </button>
        ) : (
          <p className={ui.note}>{MAX_CHOICES} choices is the most a group holds.</p>
        )}
      </fieldset>
    );
  };

  /** One combination: its price, its on/off, or just one of them when "same price" splits the two into separate rows. */
  const cellFor = (oneKey: number, twoKey: number | null, tag: string, label: string, show: 'both' | 'price' | 'switch', shared = false) => {
    const cell = cellOf(draft, oneKey, twoKey);
    return (
      <div key={twoKey ?? 'only'} className={styles.cell} data-off={cell.available ? undefined : ''}>
        {tag ? <span className={styles.tag}>{tag}</span> : null}
        {show !== 'switch' ? (
          <label className={styles.money}>
            <span>RM</span>
            <input value={cell.price} inputMode="decimal" placeholder="0.00" aria-label={`${label} price`} onChange={(event) => setCell(shared ? '*' : oneKey, twoKey, { price: event.target.value })} />
          </label>
        ) : null}
        {show !== 'price' ? (
          <button type="button" className={ui.switch} role="switch" aria-checked={cell.available} aria-label={`${label} on sale`} onClick={() => setCell(oneKey, twoKey, { available: !cell.available })}>
            <i />
          </button>
        ) : null}
      </div>
    );
  };

  const columns = two?.length ?? 1;
  return (
    <div className={styles.root}>
      {group('one')}
      {two ? (
        <>
          {group('two')}
          <button type="button" className={styles.dropGroup} onClick={() => onChange(dropGroupTwo(draft))}>
            Remove group two
          </button>
        </>
      ) : (
        <button type="button" className={ui.addRow} onClick={() => onChange(addGroupTwo(draft))}>
          + Add a second group
        </button>
      )}

      <h4 className={styles.heading}>Prices</h4>
      {two ? (
        <label className={styles.same}>
          <input type="checkbox" checked={draft.same} onChange={(event) => onChange(setSame(draft, event.target.checked))} />
          Same price for every {nameOne}
        </label>
      ) : null}
      <p className={ui.note}>Every combination needs a price, even one you switch off. Keep at least one on sale.</p>
      <div className={styles.scroll}>
        <div className={styles.grid} style={{ '--cols': columns } as CSSProperties} role="group" aria-label="Prices for every combination">
          {two ? (
            <div className={`${styles.row} ${styles.head}`} aria-hidden="true">
              <span />
              {two.map((choice, j) => (
                <span key={choice.key}>{choice.label.trim() || `${nameTwo} ${j + 1}`}</span>
              ))}
            </div>
          ) : null}
          {draft.same && two ? (
            <div className={styles.row}>
              <span className={styles.rowName}>Every {nameOne}</span>
              {two.map((t, j) => cellFor(one[0]?.key ?? 0, t.key, labelOf(t, j, 'group two'), `${labelOf(t, j, 'group two')}, every ${nameOne}`, 'price', true))}
            </div>
          ) : null}
          {draft.same && two ? (
            one.map((o, i) => (
              <div key={o.key} className={styles.row} role="group" aria-label={`${labelOf(o, i, 'group one')} on sale`}>
                <span className={styles.rowName}>{labelOf(o, i, 'group one')}</span>
                {two.map((t, j) => cellFor(o.key, t.key, labelOf(t, j, 'group two'), `${labelOf(o, i, 'group one')}, ${labelOf(t, j, 'group two')}`, 'switch'))}
              </div>
            ))
          ) : (
            one.map((o, i) => (
              <div key={o.key} className={styles.row} role="group" aria-label={labelOf(o, i, 'group one')}>
                <span className={styles.rowName}>{labelOf(o, i, 'group one')}</span>
                {two
                  ? two.map((t, j) => cellFor(o.key, t.key, labelOf(t, j, 'group two'), `${labelOf(o, i, 'group one')}, ${labelOf(t, j, 'group two')}`, 'both'))
                  : cellFor(o.key, null, '', labelOf(o, i, 'group one'), 'both')}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
