import { readFileSync } from 'node:fs';
import path from 'node:path';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OVERLAY_OPENS } from './popover.js';

vi.mock('next/navigation', () => ({ usePathname: () => '/app/orders', useSearchParams: () => new URLSearchParams(), useRouter: () => ({ push: vi.fn() }) }));
vi.mock('../../../lib/api.js', () => ({ apiFetch: vi.fn(async () => ({ sections: [], chat: true })), ApiError: class extends Error {} }));
const { SideSheet, SheetAction, SheetDanger, SheetHint } = await import('./side-sheet.js');
const { Dialog } = await import('./dialog.js');
const { AppFrame } = await import('../app-frame.js');

afterEach(() => {
  cleanup();
  document.body.style.overflow = '';
});

const css = (file: string) => readFileSync(path.resolve(__dirname, file), 'utf8').replace(/\r\n/g, '\n');

/** A page with an opener, a sheet and a dialog: the story the tests drive. */
function Story({ start = false }: { start?: boolean }) {
  const [sheet, setSheet] = useState(start);
  const [dialog, setDialog] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setSheet(true)}>
        Open sheet
      </button>
      <button type="button" onClick={() => setDialog(true)}>
        Open dialog
      </button>
      <SideSheet
        open={sheet}
        onClose={() => setSheet(false)}
        title="Mira, Peek, Lead"
        subtitle="Asked on 12 Nov"
        footer={
          <>
            <SheetAction>Reply</SheetAction>
            <SheetDanger>Remove</SheetDanger>
          </>
        }
      >
        <input aria-label="Note" />
      </SideSheet>
      <Dialog
        open={dialog}
        onClose={() => setDialog(false)}
        title="Cancel order?"
        description="You will owe Mira RM235."
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

describe('SideSheet', () => {
  it('is a modal dialog named by its title, with a 44px-class close, body and footer', () => {
    render(<Story start />);
    const sheet = screen.getByRole('dialog', { name: 'Mira, Peek, Lead' });
    expect(sheet).toHaveAttribute('aria-modal', 'true');
    expect(sheet).toHaveTextContent('Asked on 12 Nov');
    expect(screen.getAllByRole('button', { name: 'Close' })[0]).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reply' })).toBeInTheDocument();
  });

  it('is inert and hidden from assistive tech while closed, and live once asked', async () => {
    const user = userEvent.setup();
    const { container } = render(<Story />);
    const closed = [...container.querySelectorAll('[role="dialog"]')];
    expect(closed).toHaveLength(2);
    for (const el of closed) {
      expect(el).toHaveAttribute('inert');
      expect(el).toHaveAttribute('aria-hidden', 'true');
      expect(el).not.toHaveAttribute('data-open');
    }
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Open sheet' }));
    const open = screen.getByRole('dialog', { name: 'Mira, Peek, Lead' });
    expect(open).not.toHaveAttribute('inert');
    expect(open).not.toHaveAttribute('aria-hidden');
    expect(open).toHaveAttribute('data-open');
  });

  it('puts focus inside on open, and back on the opener when closed by the close button', async () => {
    const user = userEvent.setup();
    render(<Story />);
    const opener = screen.getByRole('button', { name: 'Open sheet' });
    await user.click(opener);
    expect(screen.getByRole('dialog', { name: 'Mira, Peek, Lead' }).contains(document.activeElement)).toBe(true);
    await user.click(screen.getAllByRole('button', { name: 'Close' })[0]!);
    expect(opener).toHaveFocus();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes on Escape and gives focus back', async () => {
    const user = userEvent.setup();
    render(<Story />);
    const opener = screen.getByRole('button', { name: 'Open sheet' });
    await user.click(opener);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
  });

  it('keeps Tab inside, both ways', async () => {
    const user = userEvent.setup();
    render(<Story />);
    await user.click(screen.getByRole('button', { name: 'Open sheet' }));
    const sheet = screen.getByRole('dialog', { name: 'Mira, Peek, Lead' });
    const close = screen.getAllByRole('button', { name: 'Close' })[0]!;
    expect(close).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Remove' })).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();
    for (let i = 0; i < 6; i++) {
      await user.tab();
      expect(sheet.contains(document.activeElement)).toBe(true);
    }
  });

  it('closes on a tap on the dimmed page', async () => {
    const user = userEvent.setup();
    const { container } = render(<Story start />);
    await user.click(container.querySelector('div[aria-hidden="true"]:not([role])') as HTMLElement);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('stops the page behind scrolling while open, and lets go after', async () => {
    const user = userEvent.setup();
    render(<Story />);
    await user.click(screen.getByRole('button', { name: 'Open sheet' }));
    expect(document.body.style.overflow).toBe('hidden');
    await user.keyboard('{Escape}');
    expect(document.body.style.overflow).toBe('');
  });

  it('announces itself as an overlay, so a popover or Help steps aside', async () => {
    const heard = vi.fn();
    document.addEventListener(OVERLAY_OPENS, heard);
    const user = userEvent.setup();
    render(<Story />);
    await user.click(screen.getByRole('button', { name: 'Open sheet' }));
    document.removeEventListener(OVERLAY_OPENS, heard);
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('shows a hint footer when there is nothing to press', () => {
    render(
      <SideSheet open onClose={() => {}} title="Receipt" footer={<SheetHint>Mira sent this on 12 Nov</SheetHint>}>
        <p>x</p>
      </SideSheet>,
    );
    expect(screen.getByText('Mira sent this on 12 Nov')).toBeInTheDocument();
  });
});

describe('Dialog', () => {
  it('is a modal dialog with its question and pills, closes on Escape and returns focus', async () => {
    const user = userEvent.setup();
    render(<Story />);
    const opener = screen.getByRole('button', { name: 'Open dialog' });
    await user.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'Cancel order?' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveTextContent('You will owe Mira RM235.');
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.body.style.overflow).toBe('hidden');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
  });

  it('keeps Tab inside', async () => {
    const user = userEvent.setup();
    render(<Story />);
    await user.click(screen.getByRole('button', { name: 'Open dialog' }));
    const dialog = screen.getByRole('dialog', { name: 'Cancel order?' });
    for (let i = 0; i < 5; i++) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });

  it('opened over a sheet, closing it leaves the page locked for the sheet', async () => {
    function Both() {
      const [d, setD] = useState(false);
      return (
        <>
          <SideSheet open onClose={() => {}} title="Sheet">
            <button type="button" onClick={() => setD(true)}>
              Ask
            </button>
          </SideSheet>
          <Dialog open={d} onClose={() => setD(false)} title="Sure?" />
        </>
      );
    }
    const user = userEvent.setup();
    render(<Both />);
    await user.click(screen.getByRole('button', { name: 'Ask' }));
    await user.keyboard('{Escape}');
    expect(document.body.style.overflow).toBe('hidden');
  });
});

describe('the phone menu while a sheet or dialog is open', () => {
  const frame = (children: React.ReactNode) =>
    render(
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
      </AppFrame>,
    );
  const root = () => document.querySelector('[data-laptop-scale]') as HTMLElement;

  it('marks the frame while a sheet is open, and unmarks it on close', async () => {
    const user = userEvent.setup();
    frame(<Story />);
    expect(root()).not.toHaveAttribute('data-sheet-open');
    await user.click(screen.getByRole('button', { name: 'Open sheet' }));
    expect(root()).toHaveAttribute('data-sheet-open');
    await user.keyboard('{Escape}');
    expect(root()).not.toHaveAttribute('data-sheet-open');
  });

  it('marks the frame for a dialog too', async () => {
    const user = userEvent.setup();
    frame(<Story />);
    await user.click(screen.getByRole('button', { name: 'Open dialog' }));
    expect(root()).toHaveAttribute('data-sheet-open');
  });

  it('the frame CSS hides the phone menu for data-sheet-open under 1100px', () => {
    const frameCss = css('../app-frame.module.css');
    const at = frameCss.indexOf('.frame[data-sheet-open] .phoneMenu');
    expect(at).toBeGreaterThan(0);
    expect(frameCss.slice(frameCss.lastIndexOf('@media', at), at)).toContain('(max-width: 1100px)');
    expect(frameCss.slice(at, frameCss.indexOf('}', at))).toMatch(/display:\s*none/);
  });
});

describe('the dark scrim', () => {
  it('is mapped in both dark scopes and given back to a preview island; the dialog sits above the sheet', () => {
    const frameCss = css('../app-frame.module.css');
    expect(frameCss.match(/--calm-scrim:\s*var\(--calm-dark-scrim\);/g)).toHaveLength(2);
    expect(frameCss).toMatch(/--calm-scrim:\s*var\(--light-calm-scrim\);/);
    expect(readFileSync(path.resolve(__dirname, '../../../../../packages/ui/src/tokens.css'), 'utf8')).toMatch(/--calm-dark-scrim:\s*rgb\(0 0 0 \/ 50%\);/);
    const z = (src: string, sel: string) => Number(new RegExp(`\\n\\${sel} \\{[^}]*z-index:\\s*(\\d+)`).exec(src)?.[1]);
    const sheet = css('side-sheet.module.css');
    const dialog = css('dialog.module.css');
    expect(z(dialog, '.scrim')).toBeGreaterThan(z(sheet, '.sheet'));
    expect(z(dialog, '.dialog')).toBeGreaterThan(z(dialog, '.scrim'));
  });
});

describe('side-sheet.module.css and dialog.module.css', () => {
  const sheet = css('side-sheet.module.css');
  const dialog = css('dialog.module.css');
  const rule = (src: string, selector: string) => {
    const at = src.indexOf(`\n${selector} {`);
    return at < 0 ? '' : src.slice(src.indexOf('{', at) + 1, src.indexOf('}', at));
  };

  it('sheet: 12px in, 460 wide, the surface and the calm scrim', () => {
    const r = rule(sheet, '.sheet');
    expect(r).toMatch(/top:\s*12px/);
    expect(r).toMatch(/right:\s*12px/);
    expect(r).toMatch(/bottom:\s*12px/);
    expect(r).toMatch(/width:\s*460px/);
    expect(r).toMatch(/border-radius:\s*var\(--r-box\)/);
    expect(rule(sheet, '.scrim')).toMatch(/var\(--calm-scrim\)/);
    expect(sheet).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it('sheet: closed is visibility hidden with no shadow; open is visible', () => {
    expect(rule(sheet, '.sheet')).toMatch(/visibility:\s*hidden/);
    expect(rule(sheet, '.sheet:not([data-open])')).toMatch(/box-shadow:\s*none/);
    expect(rule(sheet, '.sheet[data-open]')).toMatch(/visibility:\s*visible/);
  });

  it('sheet: a bottom sheet under 1100px, sized with dvh behind a vh fallback', () => {
    const at = sheet.indexOf('@media (max-width: 1100px)');
    const block = sheet.slice(at, sheet.indexOf('@media (prefers-reduced-motion'));
    expect(block).toMatch(/left:\s*8px/);
    expect(block).toMatch(/right:\s*8px/);
    expect(block).toMatch(/bottom:\s*calc\(8px \+ env\(safe-area-inset-bottom\)\)/);
    expect(block).toMatch(
      /height:\s*min\(720px, calc\(100vh \/ var\(--page-zoom, 1\) - 40px\)\);\s*height:\s*min\(720px, calc\(100dvh \/ var\(--page-zoom, 1\) - 40px\)\)/,
    );
  });

  it('sheet: the close is 44px and the body scrolls', () => {
    expect(rule(sheet, '.close')).toMatch(/width:\s*44px/);
    expect(rule(sheet, '.close')).toMatch(/height:\s*44px/);
    expect(rule(sheet, '.body')).toMatch(/overflow:\s*auto/);
  });

  it('dialog: centred, 440px less 24px (divided by the page zoom), padding 26, scale .97 closed and none open', () => {
    const r = rule(dialog, '.dialog');
    expect(r).toMatch(/width:\s*min\(440px, calc\(100vw \/ var\(--page-zoom, 1\) - 24px\)\)/);
    expect(r).toMatch(/padding:\s*26px/);
    expect(r).toMatch(/scale\(0\.97\)/);
    expect(r).toMatch(/visibility:\s*hidden/);
    expect(rule(dialog, '.dialog[data-open]')).toMatch(/translate\(-50%, -50%\)/);
    expect(rule(dialog, '.dialog[data-open]')).toMatch(/visibility:\s*visible/);
  });

  it('both turn their motion off under prefers-reduced-motion', () => {
    for (const src of [sheet, dialog]) {
      const block = src.slice(src.indexOf('@media (prefers-reduced-motion: reduce)'));
      expect(block).toMatch(/transition:\s*none/);
    }
  });
});
