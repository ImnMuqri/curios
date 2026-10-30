'use client';

import { useRef, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react';
import { formatRinggit, parseRinggit } from '@curios/core/store';
import { VOUCHER_NAME_MAX, checkVoucherInput, normalizeVoucherCode, voucherEndsOn, type OwnerVoucher, type VoucherInput, type VoucherKind, type VoucherMode } from '@curios/core/vouchers';
import { Callout } from '@curios/ui';
import { ApiError } from '../../../lib/api.js';
import ui from '../_ui/editor.module.css';
import { SectionHead } from '../_ui/section-head.js';
import type { VouchersApi } from './store-types.js';
import styles from './store.module.css';

const CODE_TAKEN = 'You already have a code like that.';
const TICK = 'M5 12.5l4.5 4.5L19 7.5';

const message = (failure: unknown) => (failure instanceof Error && failure.message ? failure.message : 'That did not save. Try again.');

/** "30 Nov": a day in Malaysia, where an end date is a calendar day. */
const day = (date: Date) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Kuala_Lumpur' }).format(date);

/** The last day a voucher works: it stops at the next midnight in Malaysia, so the day before. */
const lastDay = (endsAt: string) => day(new Date(Date.parse(endsAt) - 1));

/** "10% off everything", "RM5 off Kek Batik". */
function saving(v: OwnerVoucher, itemName: string | null): string {
  const off = v.kind === 'PERCENT' ? `${v.percent}%` : formatRinggit(v.amountCents ?? 0);
  return `${off} off ${v.itemId === null ? 'everything' : (itemName ?? 'one item')}`;
}

/** Where a voucher stands: "12 of 50 used" counts its uses, and its state says whether it works now. */
function stateWords(v: OwnerVoucher): string {
  switch (v.state) {
    case 'off':
      return 'Off';
    case 'ended':
      return v.endsAt ? `Ended ${lastDay(v.endsAt)}` : 'Ended';
    case 'usedUp':
      return 'Used up';
    default:
      return v.endsAt ? `Until ${lastDay(v.endsAt)}` : 'On';
  }
}
const usesWords = (v: OwnerVoucher) => (v.maxUses === null ? `${v.uses} used` : `${v.uses} of ${v.maxUses} used`);

/** A blank optional number is none; text that is not a whole number goes on as NaN, for the rule to refuse. */
const optionalCount = (text: string) => (text.trim() === '' ? null : /^\d+$/.test(text.trim()) ? Number(text.trim()) : Number.NaN);
/** A blank optional ringgit amount is none; text that is not money goes on as 0, which the rule refuses. */
const optionalCents = (text: string) => (text.trim() === '' ? null : (parseRinggit(text) ?? 0));

type Draft = { mode: VoucherMode; code: string; name: string; kind: VoucherKind; percent: string; amount: string; itemId: string; minSpend: string; endsOn: string; maxUses: string };
const BLANK: Draft = { mode: 'AUTO', code: '', name: '', kind: 'PERCENT', percent: '', amount: '', itemId: '', minSpend: '', endsOn: '', maxUses: '' };

/** "5" or "30.50": sen back as the ringgit the owner typed. */
const ringgitText = (cents: number | null) => (cents === null ? '' : cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2));

/** A voucher as the form holds it, to edit: money back from sen, and the end back to the Malaysian day it was set to. */
function draftOf(v: OwnerVoucher): Draft {
  return {
    mode: v.mode,
    code: v.code ?? '',
    name: v.name ?? '',
    kind: v.kind,
    percent: v.percent === null ? '' : String(v.percent),
    amount: ringgitText(v.amountCents),
    itemId: v.itemId ?? '',
    minSpend: ringgitText(v.minSpendCents),
    endsOn: v.endsAt === null ? '' : voucherEndsOn(v.endsAt),
    maxUses: v.maxUses === null ? '' : String(v.maxUses),
  };
}

function toInput(d: Draft): VoucherInput {
  return {
    mode: d.mode,
    code: d.mode === 'CODE' ? normalizeVoucherCode(d.code) : null,
    name: d.mode === 'AUTO' ? d.name.trim() : null,
    kind: d.kind,
    percent: d.kind === 'PERCENT' ? optionalCount(d.percent) : null,
    amountCents: d.kind === 'AMOUNT' ? optionalCents(d.amount) : null,
    itemId: d.itemId === '' ? null : d.itemId,
    minSpendCents: optionalCents(d.minSpend),
    endsOn: d.endsOn === '' ? null : d.endsOn,
    maxUses: optionalCount(d.maxUses),
  };
}

function Tile({ name, note, pressed, onClick }: { name: string; note: string; pressed: boolean; onClick: () => void }) {
  return (
    <button type="button" className={`${ui.tile} ${styles.deliveryTile}`} aria-pressed={pressed} onClick={onClick}>
      <span className={ui.tick} aria-hidden="true">
        <svg viewBox="0 0 24 24" width="12" height="12">
          <path d={TICK} />
        </svg>
      </span>
      <span>
        <b>{name}</b>
        <span>{note}</span>
      </span>
    </button>
  );
}

/**
 * The voucher form, to add one or, given `editing`, to change one: the owner's choices, checked by the
 * same rule the API applies before anything is sent. An edit sends the whole voucher as the patch, so an
 * ended one comes back by moving its last day.
 */
function VoucherForm({
  items,
  api,
  editing,
  onSaved,
  onCancel,
}: {
  items: { id: string; name: string }[];
  api: VouchersApi;
  editing?: OwnerVoucher;
  onSaved: (v: OwnerVoucher) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => (editing ? draftOf(editing) : BLANK));
  const [problem, setProblem] = useState('');
  const [codeProblem, setCodeProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((before) => ({ ...before, [key]: value }));
    setProblem('');
    setCodeProblem('');
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    const input = toInput(draft);
    const refused = checkVoucherInput(input);
    if (refused) return setProblem(refused);
    setBusy(true);
    try {
      onSaved(await (editing ? api.update(editing.id, input) : api.add(input)));
    } catch (failure) {
      if (failure instanceof ApiError && failure.code === 'VOUCHER_CODE_TAKEN') setCodeProblem(CODE_TAKEN);
      else setProblem(message(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={styles.voucherForm} onSubmit={(event) => void submit(event)} aria-label={editing ? 'Edit voucher' : 'New voucher'} noValidate>
      <div className={styles.vGroup} role="group" aria-label="How customers get it">
        <Tile name="Automatic" note="Applies by itself when it fits" pressed={draft.mode === 'AUTO'} onClick={() => set('mode', 'AUTO')} />
        <Tile name="Code" note="Customers type it at checkout" pressed={draft.mode === 'CODE'} onClick={() => set('mode', 'CODE')} />
      </div>

      {draft.mode === 'AUTO' ? (
        <div className={ui.float}>
          <label>
            <em>Name customers see</em>
            <input value={draft.name} maxLength={VOUCHER_NAME_MAX} placeholder="Raya sale" autoComplete="off" onChange={(event) => set('name', event.target.value)} />
          </label>
          <small aria-hidden="true">
            {[...draft.name].length}/{VOUCHER_NAME_MAX}
          </small>
        </div>
      ) : (
        <div>
          <div className={ui.float}>
            <label>
              <em>Code</em>
              <input className={styles.codeInput} value={draft.code} maxLength={24} placeholder="INSTA15" autoComplete="off" autoCapitalize="characters" onChange={(event) => set('code', event.target.value)} />
            </label>
          </div>
          {codeProblem ? (
            <p className={ui.saveError} role="alert">
              {codeProblem}
            </p>
          ) : (
            <p className={ui.note}>3 to 20 letters and numbers. Capitals and small letters count the same.</p>
          )}
        </div>
      )}

      <div className={styles.vGroup} role="group" aria-label="What it takes off">
        <Tile name="Percent off" note="A share of the price" pressed={draft.kind === 'PERCENT'} onClick={() => set('kind', 'PERCENT')} />
        <Tile name="Amount off" note="A fixed amount in ringgit" pressed={draft.kind === 'AMOUNT'} onClick={() => set('kind', 'AMOUNT')} />
      </div>

      <div className={styles.vGrid}>
        <div className={styles.vField}>
          <span className={styles.vLabel}>{draft.kind === 'PERCENT' ? 'How much' : 'How much, in ringgit'}</span>
          {draft.kind === 'PERCENT' ? (
            <label className={styles.money}>
              <input value={draft.percent} inputMode="numeric" aria-label="Percent off" placeholder="10" autoComplete="off" onChange={(event) => set('percent', event.target.value)} />
              <span>%</span>
            </label>
          ) : (
            <label className={styles.money}>
              <span>RM</span>
              <input value={draft.amount} inputMode="decimal" aria-label="Amount off in ringgit" placeholder="5" autoComplete="off" onChange={(event) => set('amount', event.target.value)} />
            </label>
          )}
        </div>

        <div className={styles.vField}>
          <span className={styles.vLabel}>Applies to</span>
          <select className={styles.vSelect} aria-label="Applies to" value={draft.itemId} onChange={(event) => set('itemId', event.target.value)}>
            <option value="">Whole order</option>
            {items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.vField}>
          <span className={styles.vLabel}>
            Minimum spend <i>optional</i>
          </span>
          <label className={styles.money}>
            <span>RM</span>
            <input value={draft.minSpend} inputMode="decimal" aria-label="Minimum spend in ringgit" autoComplete="off" onChange={(event) => set('minSpend', event.target.value)} />
          </label>
        </div>

        <div className={styles.vField}>
          <span className={styles.vLabel}>
            Last day <i>optional</i>
          </span>
          <input className={styles.vDate} type="date" aria-label="Last day" value={draft.endsOn} onChange={(event) => set('endsOn', event.target.value)} />
        </div>

        <div className={styles.vField}>
          <span className={styles.vLabel}>
            Uses <i>optional</i>
          </span>
          <label className={styles.money}>
            <input value={draft.maxUses} inputMode="numeric" aria-label="Uses" placeholder="No limit" autoComplete="off" onChange={(event) => set('maxUses', event.target.value)} />
          </label>
        </div>
      </div>

      {problem ? (
        <p className={ui.saveError} role="alert">
          {problem}
        </p>
      ) : null}

      <div className={styles.vActions}>
        <button type="submit" className={ui.primaryButton} disabled={busy}>
          {editing ? 'Save voucher' : 'Add voucher'}
        </button>
        <button type="button" className={styles.vCancel} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/**
 * Vouchers: what the owner offers off an order. The list says, for each, what
 * it saves, how customers get it, where it stands and how often it was used;
 * a switch turns one off or on, and deleting asks inside the page first.
 * Adding, and editing one, open a form that refuses what the API would refuse,
 * in its words. A voucher that has stopped by itself (ended, or used up) has
 * its switch shown off and held: editing its last day or uses brings it back.
 */
export function VouchersTab({ vouchers, items, api, onChange }: { vouchers: OwnerVoucher[]; items: { id: string; name: string }[]; api: VouchersApi; onChange: Dispatch<SetStateAction<OwnerVoucher[]>> }) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState('');
  // Rows with a request in flight: the ref guards a second click before the next render, the state disables the buttons.
  const inFlight = useRef(new Set<string>());
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const guard = async (id: string, run: () => Promise<void>) => {
    if (inFlight.current.has(id)) return;
    inFlight.current.add(id);
    setPending(new Set(inFlight.current));
    try {
      await run();
    } finally {
      inFlight.current.delete(id);
      setPending(new Set(inFlight.current));
    }
  };

  const setActive = (v: OwnerVoucher) =>
    guard(v.id, async () => {
      setError('');
      try {
        const next = await api.update(v.id, { active: !v.active });
        onChange((now) => now.map((other) => (other.id === v.id ? next : other)));
      } catch (failure) {
        setError(message(failure));
      }
    });

  const remove = (v: OwnerVoucher) =>
    guard(v.id, async () => {
      setError('');
      try {
        await api.remove(v.id);
        onChange((now) => now.filter((other) => other.id !== v.id));
      } catch (failure) {
        setError(message(failure));
      } finally {
        setConfirming(null);
      }
    });

  const live = vouchers.filter((v) => v.state === 'on').length;

  return (
    <section className={ui.section} aria-labelledby="vouchers-title">
      <SectionHead id="vouchers-title" title="Vouchers" note={vouchers.length === 0 ? 'Take money off an order, by itself or with a code.' : `${vouchers.length} ${vouchers.length === 1 ? 'voucher' : 'vouchers'} · ${live} on`} />

      {adding ? (
        <VoucherForm
          items={items}
          api={api}
          onCancel={() => setAdding(false)}
          onSaved={(v) => {
            onChange((now) => [v, ...now]);
            setAdding(false);
          }}
        />
      ) : null}

      {vouchers.length === 0 ? (
        adding ? null : (
          <div className={ui.empty}>
            <div className={ui.emptyArt} aria-hidden="true">
              <span className={ui.emptyBadge} data-tone="amber">
                <svg viewBox="0 0 24 24" width="21" height="21">
                  <path d="M4 8a2 2 0 0 0 0 4v4h16v-4a2 2 0 0 1 0-4V6H4zM14 6v12" />
                </svg>
              </span>
            </div>
            <h3>No vouchers yet</h3>
            <p>Give customers money off: it applies by itself when the order fits, or they type a code at checkout. One discount applies to an order, the one that saves most.</p>
            <button type="button" className={ui.primaryButton} onClick={() => setAdding(true)}>
              + Add your first voucher
            </button>
          </div>
        )
      ) : (
        <ul className={styles.itemList}>
          {vouchers.map((v) => {
            if (editing === v.id) {
              return (
                <li key={v.id} className={`${styles.voucher} ${styles.vEditRow}`} aria-label={v.label}>
                  <VoucherForm
                    items={items}
                    api={api}
                    editing={v}
                    onCancel={() => setEditing(null)}
                    onSaved={(next) => {
                      onChange((now) => now.map((other) => (other.id === v.id ? next : other)));
                      setEditing(null);
                    }}
                  />
                </li>
              );
            }
            const itemName = v.itemId === null ? null : (items.find((item) => item.id === v.itemId)?.name ?? v.itemName);
            // Ended or used up: the switch cannot bring it back, so it shows off and held, and says why.
            const stopped = v.state === 'ended' || v.state === 'usedUp';
            const stateId = `voucher-state-${v.id}`;
            return (
              <li key={v.id} className={styles.voucher} aria-label={v.label} data-state={v.state}>
                <span className={styles.voucherText}>
                  <b>{saving(v, itemName)}</b>
                  <span className={styles.voucherMeta}>
                    <span>{v.mode === 'CODE' ? `Code ${v.code ?? v.label}` : 'Automatic'}</span>
                    {v.mode === 'AUTO' ? <span>{v.name ?? v.label}</span> : null}
                    {v.minSpendCents !== null ? <span>{`Over ${formatRinggit(v.minSpendCents)}`}</span> : null}
                    <span id={stateId} data-state={v.state}>
                      {stateWords(v)}
                    </span>
                    <span>{usesWords(v)}</span>
                  </span>
                </span>
                {confirming === v.id ? (
                  <span className={ui.confirm} role="group" aria-label="Confirm delete">
                    Delete it? Past orders keep what it took off.
                    <button type="button" className={ui.confirmRemove} disabled={pending.has(v.id)} onClick={() => void remove(v)}>
                      Yes, delete
                    </button>
                    <button type="button" onClick={() => setConfirming(null)}>
                      Keep
                    </button>
                  </span>
                ) : (
                  <>
                    <button
                      type="button"
                      className={ui.switch}
                      role="switch"
                      aria-checked={stopped ? false : v.active}
                      aria-label={`Voucher on: ${v.label}`}
                      aria-describedby={stopped ? stateId : undefined}
                      disabled={stopped || pending.has(v.id)}
                      onClick={() => void setActive(v)}
                    >
                      <i />
                    </button>
                    <button type="button" className={styles.vCancel} aria-label={`Edit ${v.label}`} disabled={pending.has(v.id)} onClick={() => { setAdding(false); setEditing(v.id); }}>
                      Edit
                    </button>
                    <button type="button" className={styles.ghost} aria-label={`Delete ${v.label}`} onClick={() => setConfirming(v.id)}>
                      Delete
                    </button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {error ? <Callout tone="error">{error}</Callout> : null}

      {vouchers.length > 0 && !adding ? (
        <button type="button" className={ui.addRow} onClick={() => { setEditing(null); setAdding(true); }}>
          + Add voucher
        </button>
      ) : null}
    </section>
  );
}
