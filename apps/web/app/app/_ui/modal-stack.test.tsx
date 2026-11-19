import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('next/navigation', () => ({ usePathname: () => '/app/orders', useSearchParams: () => new URLSearchParams(), useRouter: () => ({ push: vi.fn() }) }));
vi.mock('../../../lib/api.js', () => ({ apiFetch: vi.fn(async () => ({ sections: [], chat: true })), ApiError: class extends Error {} }));
const { SideSheet, SheetAction, SheetDanger } = await import('./side-sheet.js');
const { Dialog } = await import('./dialog.js');
const { AppFrame } = await import('../app-frame.js');

afterEach(() => {
  cleanup();
  document.body.style.overflow = '';
});

/** A sheet whose own button opens a confirm Dialog over it. */
function Stacked({ onSheetClose, onDialogClose }: { onSheetClose: () => void; onDialogClose?: () => void }) {
  const [dialog, setDialog] = useState(false);
  return (
    <>
      <SideSheet open onClose={onSheetClose} title="Order 14">
        <button type="button" onClick={() => setDialog(true)}>
          Cancel order
        </button>
      </SideSheet>
      <Dialog
        open={dialog}
        onClose={() => {
          onDialogClose?.();
          setDialog(false);
        }}
        title="Cancel #14?"
        actions={
          <>
            <SheetAction>Yes, cancel</SheetAction>
            <SheetDanger>Keep it</SheetDanger>
          </>
        }
      />
    </>
  );
}

describe('stacked layers: a Dialog over a SideSheet', () => {
  it('Escape closes only the Dialog; a second Escape closes the sheet', async () => {
    const user = userEvent.setup();
    const sheetClose = vi.fn();
    render(<Stacked onSheetClose={sheetClose} />);
    await user.click(screen.getByRole('button', { name: 'Cancel order' }));
    expect(screen.getByRole('dialog', { name: 'Cancel #14?' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Cancel #14?' })).toBeNull();
    expect(sheetClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Cancel order' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(sheetClose).toHaveBeenCalledTimes(1);
  });

  it('Tab and Shift+Tab cycle through every stop in the Dialog and never reach the sheet', async () => {
    const user = userEvent.setup();
    render(<Stacked onSheetClose={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Cancel order' }));
    const dialog = screen.getByRole('dialog', { name: 'Cancel #14?' });
    const names = ['Close', 'Yes, cancel', 'Keep it'];
    const seen: string[] = [];
    for (let i = 0; i < 6; i++) {
      const el = document.activeElement as HTMLElement;
      expect(dialog.contains(el)).toBe(true);
      seen.push(el.getAttribute('aria-label') ?? el.textContent ?? '');
      await user.tab();
    }
    expect(seen).toEqual([...names, ...names]);
    await user.tab({ shift: true });
    expect((document.activeElement as HTMLElement).textContent).toBe('Keep it');
    await user.tab({ shift: true });
    expect((document.activeElement as HTMLElement).textContent).toBe('Yes, cancel');
  });

  it('an Escape something inside already handled does not close the layer', async () => {
    const user = userEvent.setup();
    const close = vi.fn();
    render(
      <SideSheet open onClose={close} title="Sheet">
        <input aria-label="Pick" onKeyDown={(e) => e.key === 'Escape' && e.preventDefault()} />
      </SideSheet>,
    );
    screen.getByLabelText('Pick').focus();
    await user.keyboard('{Escape}');
    expect(close).not.toHaveBeenCalled();
  });
});

describe('focus return', () => {
  it('falls to returnFocusTo when the opener was swapped out while open', async () => {
    const user = userEvent.setup();
    function Page() {
      const [open, setOpen] = useState(false);
      const [gen, setGen] = useState(0);
      return (
        <main>
          <button key={gen} type="button" onClick={() => setOpen(true)}>
            Row {gen}
          </button>
          <button type="button" id="swap" onClick={() => setGen((n) => n + 1)}>
            Refresh
          </button>
          <button type="button" id="home">
            Home
          </button>
          <SideSheet open={open} onClose={() => setOpen(false)} title="S" returnFocusTo="#home">
            <button type="button" onClick={() => setGen((n) => n + 1)}>
              Swap row
            </button>
          </SideSheet>
        </main>
      );
    }
    render(<Page />);
    await user.click(screen.getByRole('button', { name: 'Row 0' }));
    await user.click(screen.getByRole('button', { name: 'Swap row' }));
    await user.keyboard('{Escape}');
    expect(document.getElementById('home')).toHaveFocus();
  });

  it('with no opener and no target, goes to the main landmark, not the body', async () => {
    function Page() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <main>
            <p>page</p>
          </main>
          <SideSheet open={open} onClose={() => setOpen(false)} title="S">
            <p>x</p>
          </SideSheet>
          <button type="button" id="o" tabIndex={-1} onClick={() => setOpen(true)}>
            open
          </button>
        </>
      );
    }
    render(<Page />);
    // Safari: a clicked button takes no focus, so nothing but the body is active when the sheet opens.
    (document.activeElement as HTMLElement | null)?.blur();
    const { fireEvent } = await import('@testing-library/react');
    fireEvent.click(document.getElementById('o')!);
    await userEvent.setup().keyboard('{Escape}');
    expect(document.activeElement).toBe(document.querySelector('main'));
  });
});

describe('tab stops', () => {
  it('skip a hidden first stop, hidden inputs and collapsed sections, and include contenteditable', async () => {
    const user = userEvent.setup();
    render(
      <SideSheet open onClose={() => {}} title="S">
        <input type="hidden" name="csrf" />
        <div hidden>
          <button type="button">Collapsed</button>
        </div>
        <div style={{ display: 'none' }}>
          <button type="button">Gone</button>
        </div>
        <div contentEditable suppressContentEditableWarning aria-label="Note">
          hi
        </div>
        <button type="button" disabled>
          Off
        </button>
        <button type="button" style={{ visibility: 'hidden' }}>
          Invisible
        </button>
        <button type="button">Last</button>
      </SideSheet>,
    );
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      const el = document.activeElement as HTMLElement;
      seen.push(el.getAttribute('aria-label') ?? el.textContent ?? '');
      await user.tab();
    }
    expect(seen).toEqual(['Close', 'Note', 'Last', 'Close']);
  });
});

describe('unmount while open', () => {
  const frame = (children: React.ReactNode) => (
    <AppFrame
      displayName="Iman Muqri"
      avatarUrl={null}
      plan={{ name: 'Business plan', note: '18 days left', fill: 0.6, glance: 'Business' }}
      badges={{ review: 0, questions: 0, leads: 0, orders: 0 }}
      mode="BUSINESS"
      billingDot={false}
      alerts={[]}
    >
      {children}
    </AppFrame>
  );

  it('releases the scroll lock and the frame count (the phone menu comes back)', () => {
    function Screen({ show }: { show: boolean }) {
      return show ? (
        <SideSheet open onClose={() => {}} title="S">
          <p>x</p>
        </SideSheet>
      ) : (
        <p>other screen</p>
      );
    }
    const { rerender } = render(frame(<Screen show />));
    const root = () => document.querySelector('[data-laptop-scale]')!;
    expect(root()).toHaveAttribute('data-sheet-open');
    expect(document.body.style.overflow).toBe('hidden');
    rerender(frame(<Screen show={false} />));
    expect(root()).not.toHaveAttribute('data-sheet-open');
    expect(document.body.style.overflow).toBe('');
  });
});
