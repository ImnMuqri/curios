import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MIN_FRAME_PX, framePixels, fullFrame } from '@curios/core/item-photos';
import { PhotoCropper } from './photo-cropper.js';

afterEach(cleanup);

const W = 1200;
const H = 800;
const start = { x: 0.1, y: 0.1, size: 0.6 };

function show(over: Partial<React.ComponentProps<typeof PhotoCropper>> = {}) {
  const onSave = vi.fn();
  const onCancel = vi.fn();
  render(<PhotoCropper src="blob:x" width={W} height={H} frame={start} onSave={onSave} onCancel={onCancel} {...over} />);
  return { onSave, onCancel };
}

describe('PhotoCropper', () => {
  it('is a dialog named Adjust photo', () => {
    show();
    expect(screen.getByRole('dialog', { name: 'Adjust photo' })).toBeTruthy();
  });

  it('saves the given frame when nothing changed', () => {
    const { onSave } = show();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith(start);
  });

  it('moves 10 original pixels with ArrowRight', () => {
    const { onSave } = show();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'ArrowRight' });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const before = framePixels(start, W, H);
    const after = framePixels(onSave.mock.calls[0]![0], W, H);
    expect(after.left).toBe(before.left + 10);
    expect(after.top).toBe(before.top);
  });

  it('zooms in to the smallest square at the slider maximum', () => {
    const { onSave } = show({ frame: fullFrame(W, H) });
    const zoom = screen.getByLabelText<HTMLInputElement>('Zoom');
    fireEvent.change(zoom, { target: { value: zoom.max } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(framePixels(onSave.mock.calls[0]![0], W, H).side).toBe(MIN_FRAME_PX);
  });

  it('cancels on Escape', () => {
    const { onCancel } = show();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
  });

  it('shows Remove and Replace only with their handlers', () => {
    show();
    expect(screen.queryByRole('button', { name: 'Remove photo' })).toBeNull();
    expect(screen.queryByText('Replace picture')).toBeNull();
    cleanup();
    show({ onRemove: () => {}, onReplace: () => {} });
    expect(screen.getByRole('button', { name: 'Remove photo' })).toBeTruthy();
    expect(screen.getByText('Replace picture')).toBeTruthy();
  });

  it('passes a chosen replacement file on', () => {
    const onReplace = vi.fn();
    show({ onReplace });
    const file = new File(['x'], 'a.jpg', { type: 'image/jpeg' });
    fireEvent.change(screen.getByLabelText('Replace picture'), { target: { files: [file] } });
    expect(onReplace).toHaveBeenCalledWith(file);
  });
});
