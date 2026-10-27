import { describe, expect, it, vi } from 'vitest';
import { defaultSettings } from '@curios/core/settings';

const getStoredSettings = vi.fn(async () => defaultSettings());
vi.mock('@curios/db-read/admin', () => ({ getStoredSettings }));
vi.mock('../require-admin.js', () => ({ requireAdmin: vi.fn(async () => ({ id: 'a1' })) }));
vi.mock('./controls-screen.js', () => ({ ControlsScreen: () => null, ControlsUnavailable: () => null }));

const { default: ControlsPage } = await import('./page.js');
const { ControlsScreen, ControlsUnavailable } = await import('./controls-screen.js');

describe('ControlsPage', () => {
  it('hands the stored settings to the form', async () => {
    const settings = { ...defaultSettings(), cap: 321 };
    getStoredSettings.mockResolvedValueOnce(settings);

    const element = await ControlsPage();

    expect(element.type).toBe(ControlsScreen);
    expect(element.props).toEqual({ settings });
  });

  it('shows the error state, not the form, when the read fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    getStoredSettings.mockRejectedValueOnce(new Error('connection refused'));

    const element = await ControlsPage();

    expect(element.type).toBe(ControlsUnavailable);
  });
});
