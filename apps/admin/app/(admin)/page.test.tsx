import { describe, expect, it, vi } from 'vitest';
import { defaultSettings } from '@curios/core/settings';

const getOverview = vi.fn(async () => ({}));
vi.mock('@curios/db-read/admin', () => ({ getOverview }));
const getSettings = vi.fn(async () => defaultSettings());
vi.mock('@curios/db-read', () => ({ getSettings }));
vi.mock('./require-admin.js', () => ({ requireAdmin: vi.fn(async () => ({ id: 'a1' })) }));
const Overview = vi.fn(() => null);
vi.mock('./overview.js', () => ({ Overview }));

const { default: OverviewPage } = await import('./page.js');

describe('OverviewPage', () => {
  it('names the cap the admin set in the at-the-limit line, not the default', async () => {
    getSettings.mockResolvedValueOnce({ ...defaultSettings(), cap: 10 });

    const element = await OverviewPage({ searchParams: Promise.resolve({}) });

    expect(element.props).toMatchObject({ cap: 10, period: '7d' });
  });
});
