import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppearanceEditor } from './appearance-editor.js';
import type { AppearancePatch } from './my-curios.js';

const setup = (overrides: Partial<{ save: (patch: object) => Promise<unknown> }> = {}) => {
  const props = { background: 'PAPER' as const, style: 'SOFT' as const, accentColor: '#2340c8', headingFont: 'JAKARTA' as const, onChange: vi.fn(), save: vi.fn(async () => undefined), ...overrides };
  render(<AppearanceEditor {...props} />);
  return props;
};

/** AppearanceEditor is controlled; a real caller (MyCuriosEditor) keeps the
 * choice in state and feeds it back through `onChange`, which is what lets
 * the chosen radio stay checked across a failed save rather than reverting
 * to whatever a static prop said. This stands in for that caller, the same
 * way profile-editor.test.tsx's `Controlled` does for ProfileEditor. */
function Controlled({ save }: { save: (patch: AppearancePatch) => Promise<unknown> }) {
  const [state, setState] = useState<{ background: 'PAPER' | 'MUDA' | 'KUNING' | 'BIRU' | 'INK'; style: 'SOFT' | 'CONTRAST'; accentColor: string; headingFont: 'JAKARTA' | 'BRICOLAGE' | 'FRAUNCES' | 'SPACE_GROTESK' | 'DM_SERIF' | 'OUTFIT' }>({
    background: 'PAPER',
    style: 'SOFT',
    accentColor: '#2340c8',
    headingFont: 'JAKARTA',
  });
  return (
    <AppearanceEditor
      {...state}
      onChange={(change) => setState((s) => ({ ...s, ...change }))}
      save={save}
    />
  );
}

describe('AppearanceEditor', () => {
  it('switches style and saves it at once', async () => {
    const props = setup();
    await userEvent.click(screen.getByRole('radio', { name: 'High contrast' }));
    expect(props.onChange).toHaveBeenCalledWith({ style: 'CONTRAST' });
    expect(props.save).toHaveBeenCalledWith({ style: 'CONTRAST' });
  });

  it('picks a preset accent', async () => {
    const props = setup();
    await userEvent.click(screen.getByRole('radio', { name: 'Purple' }));
    expect(props.save).toHaveBeenCalledWith({ accentColor: '#6d3fb3' });
  });

  // Fix round 2, Minor #8: a hex string read out loud ("Accent pound sign
  // zero c seven a six two") tells a screen-reader user nothing a sighted
  // owner does not already get from the swatch's own colour. Each preset
  // gets a human name; the hex still shows, as the swatch's title, for
  // whoever wants it.
  it('names every preset swatch for a screen reader, and keeps the hex as its title', () => {
    setup();
    const names = ['Biru', 'Hijau', 'Purple', 'Magenta', 'Red', 'Amber', 'Forest', 'Ink'];
    for (const name of names) {
      expect(screen.getByRole('radio', { name })).toBeInTheDocument();
    }
    expect(screen.getByRole('radio', { name: 'Biru' }).closest('label')).toHaveAttribute('title', '#2340c8');
  });

  it('takes a custom colour typed as hex, and refuses one that is not', async () => {
    const props = setup();
    const custom = screen.getByLabelText('Custom colour');
    await userEvent.clear(custom);
    await userEvent.type(custom, 'banana');
    expect(screen.getByRole('alert')).toHaveTextContent(/six-digit hex/i);
    expect(props.save).not.toHaveBeenCalled();

    await userEvent.clear(custom);
    await userEvent.type(custom, '#123abc');
    expect(props.save).toHaveBeenLastCalledWith({ accentColor: '#123abc' });
  });

  it('picks a heading font, each shown in itself', async () => {
    const props = setup();
    const fraunces = screen.getByRole('radio', { name: 'Fraunces' });
    expect(fraunces.closest('label')).toHaveStyle({ fontFamily: 'var(--font-fraunces)' });
    await userEvent.click(fraunces);
    expect(props.save).toHaveBeenCalledWith({ headingFont: 'FRAUNCES' });
  });

  // Self-review gap: none of the tests above ever let `save` reject, so a
  // dropped `.catch` would still show every test above green.
  it('shows an error when a save fails', async () => {
    setup({ save: vi.fn(async () => { throw new Error('nope'); }) });
    await userEvent.click(screen.getByRole('radio', { name: 'High contrast' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/did not save/i);
  });

  // Self-review gap: the existing hex test only ever types already-lowercase
  // hex, so a dropped `.toLowerCase()` would still show it green.
  it('takes a custom colour typed in upper case, and saves it lower-cased', async () => {
    const props = setup();
    const custom = screen.getByLabelText('Custom colour');
    await userEvent.clear(custom);
    await userEvent.type(custom, '#ABCDEF');
    expect(props.save).toHaveBeenLastCalledWith({ accentColor: '#abcdef' });
  });

  // Self-review gap: choosing a preset also updates the custom field
  // (`setCustom(hex)`, so the two controls agree on the current colour); no
  // test read the custom field's value after a preset click.
  it('syncs the custom colour field to a chosen preset', async () => {
    setup();
    await userEvent.click(screen.getByRole('radio', { name: 'Purple' }));
    expect(screen.getByLabelText('Custom colour')).toHaveValue('#6d3fb3');
  });

  // Fix round 1: a failed save left the choice showing with an error and no
  // way to act on it. Retry must resend exactly the patch that failed, and
  // succeeding must clear the error.
  it('retries a failed save with the same patch, and clears the error once it saves', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(undefined);
    render(<Controlled save={save} />);

    await userEvent.click(screen.getByRole('radio', { name: 'High contrast' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/did not save/i);

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith({ style: 'CONTRAST' });
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  // Fix round 1, controller ruling: do not roll back. The chosen radio must
  // stay checked through a failed save -- the owner's input is kept, not
  // reverted, while the error and Retry give them a way to act on it.
  it('keeps the chosen radio checked after a failed save', async () => {
    const save = vi.fn(async () => { throw new Error('offline'); });
    render(<Controlled save={save} />);

    await userEvent.click(screen.getByRole('radio', { name: 'High contrast' }));
    await screen.findByRole('alert');

    expect(screen.getByRole('radio', { name: 'High contrast' })).toBeChecked();
  });
});

describe('AppearanceEditor background', () => {
  it('saves the background band the owner picks', async () => {
    const save = vi.fn(async () => undefined);
    const onChange = vi.fn();
    render(<AppearanceEditor background="PAPER" style="SOFT" accentColor="#2340c8" headingFont="JAKARTA" onChange={onChange} save={save} />);
    await userEvent.click(screen.getByRole('radio', { name: /dark/i }));
    expect(save).toHaveBeenCalledWith({ background: 'INK' });
    expect(onChange).toHaveBeenCalledWith({ background: 'INK' });
  });
});
