import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProfileEditor } from './profile-editor.js';

/** ProfileEditor's fields are controlled; a real caller (MyCuriosEditor) keeps
 * the typed value in state and feeds it back through `onChange`, which is
 * what lets a keystroke actually accumulate rather than being reset on every
 * render. This stands in for that caller so the test types like a person. */
function Controlled({
  save,
  uploadsEnabled = false,
  avatarUrl = null,
  onAvatar = () => undefined,
  uploadAvatar = async () => null,
  removeAvatar = async () => undefined,
}: {
  save: (patch: { displayName?: string; bio?: string | null }) => Promise<unknown>;
  uploadsEnabled?: boolean;
  avatarUrl?: string | null;
  onAvatar?: (url: string | null) => void;
  uploadAvatar?: (file: File) => Promise<string | null>;
  removeAvatar?: () => Promise<void>;
}) {
  const [state, setState] = useState({ displayName: 'Iman', bio: null as string | null });
  return (
    <ProfileEditor
      {...state}
      onChange={(change) => setState((s) => ({ ...s, ...change }))}
      save={save}
      uploadsEnabled={uploadsEnabled}
      avatarUrl={avatarUrl}
      onAvatar={onAvatar}
      uploadAvatar={uploadAvatar}
      removeAvatar={removeAvatar}
    />
  );
}

describe('ProfileEditor', () => {
  it('autosaves the bio after typing stops', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const save = vi.fn(async () => undefined);
    render(<Controlled save={save} />);

    const bio = screen.getByLabelText('Bio');
    await userEvent.type(bio, 'Hello', { delay: null });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });

    expect(save).toHaveBeenLastCalledWith({ bio: 'Hello' });
    vi.useRealTimers();
  });

  // The other half of profile-editor.tsx's SaveState wiring: a failed save
  // must offer Retry, and Retry must send the request again.
  it('offers Retry and saves again when the profile fails to save', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const save = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(undefined);
    render(<Controlled save={save} />);

    const name = screen.getByLabelText('Display name');
    await userEvent.type(name, '!', { delay: null });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });

    const retry = screen.getByRole('button', { name: 'Retry' });
    await userEvent.click(retry, { delay: null });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    expect(save).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    vi.useRealTimers();
  });
});

const base = { displayName: 'Iman', bio: null, onChange: vi.fn(), save: vi.fn(async () => undefined), avatarUrl: null, onAvatar: vi.fn(), removeAvatar: vi.fn(async () => undefined) };

describe('ProfileEditor picture', () => {
  it('offers no upload when storage is off', () => {
    render(<ProfileEditor {...base} uploadsEnabled={false} uploadAvatar={vi.fn()} />);
    expect(screen.queryByLabelText('Upload a picture')).toBeNull();
  });

  it('uploads a chosen file and shows the new picture', async () => {
    const onAvatar = vi.fn();
    const uploadAvatar = vi.fn(async () => 'https://cdn.example/a.webp');
    render(<ProfileEditor {...base} onAvatar={onAvatar} uploadsEnabled uploadAvatar={uploadAvatar} />);

    await userEvent.upload(screen.getByLabelText('Upload a picture'), new File(['x'], 'me.png', { type: 'image/png' }));

    expect(uploadAvatar).toHaveBeenCalled();
    expect(onAvatar).toHaveBeenCalledWith('https://cdn.example/a.webp');
  });

  it('keeps the old picture and says why when an upload fails', async () => {
    const onAvatar = vi.fn();
    const uploadAvatar = vi.fn(async () => { throw new Error('That picture could not be used.'); });
    render(<ProfileEditor {...base} avatarUrl="https://cdn.example/old.webp" onAvatar={onAvatar} uploadsEnabled uploadAvatar={uploadAvatar} />);

    await userEvent.upload(screen.getByLabelText('Upload a picture'), new File(['x'], 'me.png', { type: 'image/png' }));

    expect(onAvatar).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/could not be used/i);
  });

  it('offers no Remove picture button when there is no picture', () => {
    render(<ProfileEditor {...base} uploadsEnabled uploadAvatar={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Remove picture' })).toBeNull();
  });

  it('removes the picture when Remove picture is clicked', async () => {
    const removeAvatar = vi.fn(async () => undefined);
    render(<ProfileEditor {...base} avatarUrl="https://cdn.example/old.webp" uploadsEnabled uploadAvatar={vi.fn()} removeAvatar={removeAvatar} />);

    await userEvent.click(screen.getByRole('button', { name: 'Remove picture' }));

    expect(removeAvatar).toHaveBeenCalled();
  });

  it('says why when removing the picture fails', async () => {
    const removeAvatar = vi.fn(async () => { throw new Error('offline'); });
    render(<ProfileEditor {...base} avatarUrl="https://cdn.example/old.webp" uploadsEnabled uploadAvatar={vi.fn()} removeAvatar={removeAvatar} />);

    await userEvent.click(screen.getByRole('button', { name: 'Remove picture' }));

    expect(screen.getByRole('alert')).toHaveTextContent(/did not save/i);
  });
});
