import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { MyCurios as MyCuriosData } from '@curios/db-read';

const getMyCurios = vi.fn();
// No topics yet, and a business page: the preview offers the first business starter.
const getTopics = vi.fn(async () => [] as { title: string }[]);
const getOwnerPage = vi.fn(async () => ({ mode: 'BUSINESS' }));
vi.mock('@curios/db-read', () => ({ getMyCurios, getTopics, getOwnerPage }));

const resolveOwner = vi.fn();
vi.mock('../session.js', () => ({ resolveOwner }));

vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve({ get: () => ({ value: 'a-session-value' }) }),
}));

// Throws, because the real `redirect` throws NEXT_REDIRECT. A mock that
// merely records the call lets control fall through past a redirect the
// component should not survive.
const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});
vi.mock('next/navigation', () => ({ redirect }));

// The wrapper closes over apiFetch and builds the real CuriosApi. These tests
// are about what the page decides to show and pass down, so the wrapper
// records that it was rendered, and with what, instead of hitting the API.
const MyCurios = vi.fn((_props: unknown) => null);
vi.mock('./my-curios-wrapper.js', () => ({ MyCurios }));

const MyCuriosPage = (await import('./page.js')).default;

const page: MyCuriosData = {
  id: 'p1',
  handle: 'imnmuqri',
  displayName: 'Iman Muqri',
  bio: null,
  style: 'SOFT',
  accentColor: '#2340c8',
  headingFont: 'JAKARTA',
  avatarKey: 'avatars/p1.jpg',
  coverKey: null,
  background: 'PAPER', backgroundColor: null, language: 'en', shop: null,
  socials: [], shopTab: null,
  links: [],
};

describe('MyCuriosPage', () => {
  const originalStorageUrl = process.env.STORAGE_PUBLIC_URL;

  beforeEach(() => {
    getMyCurios.mockReset();
    resolveOwner.mockReset();
    MyCurios.mockClear();
    redirect.mockClear();
    process.env.STORAGE_PUBLIC_URL = originalStorageUrl;
  });

  it('sends a signed-out visitor to sign in', async () => {
    resolveOwner.mockResolvedValue(null);

    await expect(MyCuriosPage()).rejects.toThrow('NEXT_REDIRECT:/signin');
    // Stopped, not merely redirected: a page the code runs past anyway would
    // fetch data for an owner who was never confirmed.
    expect(getMyCurios).not.toHaveBeenCalled();
  });

  it('sends an owner with no page yet to onboarding', async () => {
    resolveOwner.mockResolvedValue({ accountId: 'acc-1' });
    getMyCurios.mockResolvedValue(null);

    await expect(MyCuriosPage()).rejects.toThrow('NEXT_REDIRECT:/app/onboarding');
  });

  it("hands the editor the page's data plus its computed picture URL", async () => {
    process.env.STORAGE_PUBLIC_URL = 'https://cdn.example';
    resolveOwner.mockResolvedValue({ accountId: 'acc-1' });
    getMyCurios.mockResolvedValue(page);

    render(await MyCuriosPage());

    expect(MyCurios).toHaveBeenCalledTimes(1);
    const props = MyCurios.mock.calls[0]?.[0] as { initial: MyCuriosData & { avatarUrl: string | null }; uploadsEnabled: boolean; publicBase: string };
    expect(props.initial).toEqual({ ...page, avatarUrl: 'https://cdn.example/avatars/p1.jpg', coverUrl: null, shopItems: [], previewQuestion: 'How much is it?' });
    expect(props.uploadsEnabled).toBe(true);
    // The client component cannot read a server-only env var itself, so the
    // wrapper needs it passed down to build an uploaded picture's URL.
    expect(props.publicBase).toBe('https://cdn.example');
  });

  it("hands the editor the page's full address, for the copy button", async () => {
    resolveOwner.mockResolvedValue({ accountId: 'acc-1' });
    getMyCurios.mockResolvedValue(page);
    const appUrl = process.env.APP_URL;
    process.env.APP_URL = 'https://curios.my';

    render(await MyCuriosPage());

    const props = MyCurios.mock.calls[0]?.[0] as { publicUrl: string };
    expect(props.publicUrl).toBe('https://curios.my/imnmuqri');
    process.env.APP_URL = appUrl;
  });

  it("hands the editor the first items for sale, with their photos' URLs", async () => {
    process.env.STORAGE_PUBLIC_URL = 'https://cdn.example';
    resolveOwner.mockResolvedValue({ accountId: 'acc-1' });
    getMyCurios.mockResolvedValue({
      ...page,
      shopTab: { open: true, itemCount: 2, preview: [{ name: 'Kek coklat', priceCents: 9500, photoKey: 'items/i1.jpg' }, { name: 'Kek batik', priceCents: null, photoKey: null }] },
    });

    render(await MyCuriosPage());

    const props = MyCurios.mock.calls[0]?.[0] as { initial: { shopItems: unknown[] } };
    expect(props.initial.shopItems).toEqual([
      { name: 'Kek coklat', priceCents: 9500, photoUrl: 'https://cdn.example/items/i1.jpg' },
      { name: 'Kek batik', priceCents: null, photoUrl: null },
    ]);
  });

  it('says uploads are off, and the picture is null, when storage is not configured', async () => {
    delete process.env.STORAGE_PUBLIC_URL;
    resolveOwner.mockResolvedValue({ accountId: 'acc-1' });
    getMyCurios.mockResolvedValue(page);

    render(await MyCuriosPage());

    const props = MyCurios.mock.calls[0]?.[0] as { initial: { avatarUrl: string | null }; uploadsEnabled: boolean; publicBase: string };
    expect(props.uploadsEnabled).toBe(false);
    expect(props.initial.avatarUrl).toBeNull();
    expect(props.publicBase).toBe('');
  });

  it('offers the most-asked question in the preview, once there is one', async () => {
    resolveOwner.mockResolvedValue({ accountId: 'acc-1' });
    getMyCurios.mockResolvedValue(page);
    getTopics.mockResolvedValueOnce([{ title: 'Do you deliver to Klang?' }]);

    render(await MyCuriosPage());

    const props = MyCurios.mock.calls.at(-1)?.[0] as { initial: { previewQuestion: string } };
    expect(props.initial.previewQuestion).toBe('Do you deliver to Klang?');
  });
});
