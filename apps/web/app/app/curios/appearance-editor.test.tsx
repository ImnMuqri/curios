import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppearanceEditor } from './appearance-editor.js';

const setup = (overrides: Partial<{ save: (patch: object) => Promise<unknown> }> = {}) => {
  const props = { style: 'SOFT' as const, accentColor: '#0c7a62', headingFont: 'JAKARTA' as const, onChange: vi.fn(), save: vi.fn(async () => undefined), ...overrides };
  render(<AppearanceEditor {...props} />);
  return props;
};

describe('AppearanceEditor', () => {
  it('switches style and saves it at once', async () => {
    const props = setup();
    await userEvent.click(screen.getByRole('radio', { name: 'High contrast' }));
    expect(props.onChange).toHaveBeenCalledWith({ style: 'CONTRAST' });
    expect(props.save).toHaveBeenCalledWith({ style: 'CONTRAST' });
  });

  it('picks a preset accent', async () => {
    const props = setup();
    await userEvent.click(screen.getByRole('radio', { name: 'Accent #6d3fb3' }));
    expect(props.save).toHaveBeenCalledWith({ accentColor: '#6d3fb3' });
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
    await userEvent.click(screen.getByRole('radio', { name: 'Accent #6d3fb3' }));
    expect(screen.getByLabelText('Custom colour')).toHaveValue('#6d3fb3');
  });
});
