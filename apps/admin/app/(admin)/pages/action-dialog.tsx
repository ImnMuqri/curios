'use client';

import { useRouter } from 'next/navigation';
import { ApiError, apiFetch } from '../../../lib/api.js';
import { ReasonDialog } from '../reason-dialog.js';

export type ActionKind = 'suspend' | 'unsuspend' | 'del' | 'comp' | 'reset' | 'owner';

export interface DialogPage {
  id: string;
  handle: string;
  displayName: string;
}

interface Copy {
  title: string;
  body: string;
  confirm: string;
  placeholder: string;
  danger: boolean;
  toast: string;
}

/** The board's `M.kind` table, word for word; `owner` is the one kind the board draws no dialog for. */
export function copyFor(kind: ActionKind, p: DialogPage): Copy {
  switch (kind) {
    case 'suspend':
      return {
        title: `Suspend curios.my/${p.handle}?`,
        body: 'The page shows “This page is unavailable” and its chat stops. The owner can still sign in and is emailed the reason.',
        confirm: 'Suspend page',
        placeholder: 'E.g. Scam reports, asking for transfers first',
        danger: true,
        toast: `curios.my/${p.handle} is suspended.`,
      };
    case 'unsuspend':
      return {
        title: `Bring curios.my/${p.handle} back?`,
        body: 'The page and its chat go live again straight away.',
        confirm: 'Bring it back',
        placeholder: 'E.g. Owner fixed the prices',
        danger: false,
        toast: `curios.my/${p.handle} is live again.`,
      };
    case 'del':
      return {
        title: `Delete ${p.displayName}’s account?`,
        body: 'Their page, facts, leads and orders are removed. Payments stay, as financial records. This can’t be undone.',
        confirm: 'Delete account',
        placeholder: 'E.g. Owner asked by email',
        danger: true,
        toast: 'Account deleted.',
      };
    case 'comp':
      return {
        title: `Give ${p.displayName} a month of Business?`,
        body: 'Paid until moves forward by one month. No payment is made or recorded as revenue.',
        confirm: 'Give one month',
        placeholder: 'E.g. Sorry for the outage on 20 Oct',
        danger: false,
        toast: 'One month added.',
      };
    case 'reset':
      return {
        title: `Reset ${p.displayName}’s conversations?`,
        body: 'This month’s count goes back to 0, so the chat answers again until it reaches 200.',
        confirm: 'Reset to 0',
        placeholder: 'E.g. Count was inflated by a bot',
        danger: false,
        toast: 'Conversations reset to 0.',
      };
    case 'owner':
      return {
        title: `See ${p.displayName} as the owner?`,
        body: 'Opens their dashboard read-only, with phone numbers and names masked and no messages. The visit is logged with your reason.',
        confirm: 'See it as the owner',
        placeholder: 'E.g. Owner says the shop shows no items',
        danger: false,
        toast: '',
      };
  }
}

const ROUTE: Record<Exclude<ActionKind, 'del'>, string> = {
  suspend: 'suspend',
  unsuspend: 'unsuspend',
  comp: 'grant-month',
  reset: 'reset-conversations',
  owner: 'view-as-owner',
};

export function ActionDialog({
  kind,
  page,
  onClose,
  onDone,
}: {
  kind: ActionKind;
  page: DialogPage;
  onClose: () => void;
  /** Called after the API said yes; `toast` is the board's text for the action. */
  onDone: (toast: string) => void;
}) {
  const router = useRouter();
  const copy = copyFor(kind, page);

  async function confirm(reason: string) {
    try {
      const base = `/admin/pages/${encodeURIComponent(page.id)}`;
      if (kind === 'del') {
        await apiFetch(base, { method: 'DELETE', body: JSON.stringify({ reason, handle: page.handle }) });
      } else {
        await apiFetch(`${base}/${ROUTE[kind]}`, { method: 'POST', body: JSON.stringify({ reason }) });
      }
    } catch (e) {
      throw e instanceof ApiError ? e : new Error('Something failed. Try again.');
    }
    if (kind === 'owner') {
      // The API wrote the VIEWED_AS_OWNER row; the route behind this only reads.
      router.push(`/pages/${page.id}/as-owner`);
      onDone('');
      return;
    }
    router.refresh();
    onDone(copy.toast);
  }

  return (
    <ReasonDialog
      title={copy.title}
      text={copy.body}
      confirmLabel={copy.confirm}
      placeholder={copy.placeholder}
      danger={copy.danger}
      ownerSees={kind === 'suspend' || kind === 'unsuspend'}
      typeToConfirm={kind === 'del' ? page.handle : undefined}
      onConfirm={confirm}
      onClose={onClose}
    />
  );
}
