'use client';

import { useState } from 'react';
import { useAutosave } from '../_ui/use-autosave.js';
import type { SettingsPatch, StoreSettings } from './store-types.js';

/**
 * One typed store setting: what the owner sees in the field, saved once they
 * pause. `toPatch` turns the text into what is sent, or a sentence to show
 * instead when it cannot be (a fee that is not a number); the API's own
 * refusal (a bad account number, a shop left with no way to pay) comes back
 * through the autosave's error.
 */
export function useSettingText(
  initial: string,
  toPatch: (text: string) => SettingsPatch | { problem: string },
  save: (patch: SettingsPatch) => Promise<StoreSettings>,
) {
  const [text, setText] = useState(initial);
  const [problem, setProblem] = useState('');
  const autosave = useAutosave(save);

  function change(next: string) {
    setText(next);
    const patch = toPatch(next);
    if ('problem' in patch) {
      setProblem(patch.problem);
      return;
    }
    setProblem('');
    autosave.schedule(patch);
  }

  return { text, change, problem, autosave };
}

/** Blank is no value at all, not an empty one. */
export const orNull = (text: string) => text.trim() || null;
