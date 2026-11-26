'use client';

import type { ItemChoices } from '@curios/core/store';
import type { ShopCopy } from '../copy.js';
import styles from './product.module.css';

export interface PickedChoices {
  oneId: string | null;
  twoId: string | null;
}

/** The first combination on sale, which is what the page opens on. */
export function firstAvailable(choices: ItemChoices): PickedChoices {
  const first = choices.combos.find((c) => c.available);
  return { oneId: first?.oneId ?? null, twoId: first?.twoId ?? null };
}

interface Pick {
  id: string;
  label: string;
  off: boolean;
  photoKey?: string | null;
}

/** One radiogroup; arrows step over the choices that can be had, a greyed one is announced but never taken. */
function Row(props: { id: string; heading: string; picks: Pick[]; value: string | null; tiles: boolean; photoUrlOf: (key: string) => string | null; offText: string; onPick: (pick: Pick) => void }) {
  const { picks } = props;
  return (
    <>
      <span className={styles.lbl} id={props.id}>
        {props.heading}
      </span>
      <div className={props.tiles ? styles.tiles : styles.opts} role="radiogroup" aria-labelledby={props.id}>
        {picks.map((p, i) => {
          const url = props.tiles && p.photoKey ? props.photoUrlOf(p.photoKey) : null;
          return (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={p.id === props.value}
              aria-disabled={p.off || undefined}
              data-off={p.off || undefined}
              tabIndex={p.id === props.value ? 0 : -1}
              onClick={() => {
                if (!p.off) props.onPick(p);
              }}
              onKeyDown={(event) => {
                const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
                if (step === 0) return;
                event.preventDefault();
                for (let hop = 1; hop <= picks.length; hop += 1) {
                  const at = (i + step * hop + picks.length * hop) % picks.length;
                  const next = picks[at];
                  if (next && !next.off) {
                    props.onPick(next);
                    (event.currentTarget.parentElement?.children[at] as HTMLElement | undefined)?.focus();
                    return;
                  }
                }
              }}
            >
              {props.tiles ? (
                <span className={styles.tileImg} aria-hidden="true">
                  {url ? <img src={url} alt="" draggable={false} loading="lazy" decoding="async" /> : <i>{p.label.trim().charAt(0).toUpperCase()}</i>}
                </span>
              ) : null}
              <b>{p.label}</b>
              {p.off ? <small className={styles.sr}>{props.offText}</small> : null}
            </button>
          );
        })}
      </div>
    </>
  );
}

/**
 * The two groups of an item's choices. Group one is photo tiles when any of its choices has a photo, else chips;
 * group two is chips. A choice with no combination on sale (given the other pick, for group two) is greyed.
 */
export function ChoicesPicker(props: {
  choices: ItemChoices;
  picked: PickedChoices;
  onPick: (next: PickedChoices) => void;
  photoUrlOf: (photoKey: string) => string | null;
  /** A group-one choice with a photo was picked: show that photo. */
  onPhoto: (photoKey: string) => void;
  copy: ShopCopy;
}) {
  const { choices, picked, copy } = props;
  const { groupOne, groupTwo, combos } = choices;
  const tiles = groupOne.choices.some((c) => c.photoKey);
  const one = groupOne.choices.find((c) => c.id === picked.oneId);
  const two = groupTwo?.choices.find((c) => c.id === picked.twoId);

  function pickOne(id: string) {
    const pick = groupOne.choices.find((c) => c.id === id);
    let twoId = picked.twoId;
    if (groupTwo && !combos.some((c) => c.oneId === id && c.twoId === twoId && c.available)) {
      twoId = combos.find((c) => c.oneId === id && c.available)?.twoId ?? null;
    }
    props.onPick({ oneId: id, twoId });
    if (pick?.photoKey) props.onPhoto(pick.photoKey);
  }

  return (
    <>
      <Row
        id="product-choice-one"
        heading={one ? copy.choicePicked(groupOne.name, one.label) : groupOne.name}
        picks={groupOne.choices.map((c) => ({ id: c.id, label: c.label, photoKey: c.photoKey, off: !combos.some((o) => o.oneId === c.id && o.available) }))}
        value={picked.oneId}
        tiles={tiles}
        photoUrlOf={props.photoUrlOf}
        offText={copy.choiceOff}
        onPick={(p) => pickOne(p.id)}
      />
      {groupTwo ? (
        <Row
          id="product-choice-two"
          heading={two ? copy.choicePicked(groupTwo.name, two.label) : groupTwo.name}
          picks={groupTwo.choices.map((c) => ({ id: c.id, label: c.label, off: !combos.some((o) => o.oneId === picked.oneId && o.twoId === c.id && o.available) }))}
          value={picked.twoId}
          tiles={false}
          photoUrlOf={props.photoUrlOf}
          offText={copy.choiceOff}
          onPick={(p) => props.onPick({ oneId: picked.oneId, twoId: p.id })}
        />
      ) : null}
    </>
  );
}
