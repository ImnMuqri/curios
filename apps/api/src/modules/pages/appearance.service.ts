import type { PrismaClient } from '@curios/db';
import {
  BIO_MAX,
  charCount,
  DISPLAY_NAME_MAX,
  isHexColor,
  type HeadingFont,
  type PageBackground,
  type PageStyle,
} from '@curios/core/bento';
import { normalizeSocial, SOCIAL_KINDS, tidySocials, type SocialKind, type Socials } from '@curios/core/socials';
import { NoPageError } from './page.service.js';

export class InvalidAppearanceError extends Error {
  readonly statusCode = 400;
  readonly code = 'INVALID_APPEARANCE';
  constructor(message: string) {
    super(message);
    this.name = 'InvalidAppearanceError';
  }
}

export interface Appearance {
  style: PageStyle;
  background: PageBackground;
  backgroundColor: string | null;
  accentColor: string;
  headingFont: HeadingFont;
  displayName: string;
  bio: string | null;
  /** The filled-in profiles, by kind. */
  socials: Socials;
}

const SOCIAL_NAMES: Record<SocialKind, string> = {
  instagram: 'Instagram handle',
  whatsapp: 'WhatsApp number',
  tiktok: 'TikTok handle',
  email: 'email address',
  facebook: 'Facebook page name',
  youtube: 'YouTube handle',
};

function asSocials(stored: unknown): Socials {
  return Object.fromEntries(tidySocials(stored).map(({ kind, value }) => [kind, value]));
}

export async function updateAppearance(
  prisma: PrismaClient,
  accountId: string,
  input: Partial<Omit<Appearance, 'bio' | 'socials'>> & { bio?: string | null; socials?: Socials },
): Promise<Appearance> {
  const data: Partial<Omit<Appearance, 'socials'>> & { socials?: Socials } = {};
  if (input.style !== undefined) data.style = input.style;
  if (input.background !== undefined) data.background = input.background;
  if (input.backgroundColor !== undefined && input.backgroundColor !== null) {
    if (!isHexColor(input.backgroundColor)) throw new InvalidAppearanceError('Pick a colour, or type one as six-digit hex like #eaf0ff.');
    data.backgroundColor = input.backgroundColor.toLowerCase();
  }
  // Custom needs a colour: this one, or the one saved before.
  if (data.background === 'CUSTOM' && data.backgroundColor === undefined) {
    const stored = await prisma.page.findUnique({ where: { accountId }, select: { backgroundColor: true } });
    if (!stored?.backgroundColor) throw new InvalidAppearanceError('Pick a background colour first.');
  }
  if (input.headingFont !== undefined) data.headingFont = input.headingFont;
  if (input.accentColor !== undefined) {
    if (!isHexColor(input.accentColor)) throw new InvalidAppearanceError('Pick a colour, or type one as six-digit hex like #2340c8.');
    data.accentColor = input.accentColor.toLowerCase();
  }
  if (input.displayName !== undefined) {
    const name = input.displayName.trim();
    if (name === '' || charCount(name) > DISPLAY_NAME_MAX) {
      throw new InvalidAppearanceError(`Your name is needed, up to ${DISPLAY_NAME_MAX} characters.`);
    }
    data.displayName = name;
  }
  if (input.bio !== undefined) {
    const bio = input.bio?.trim() ?? '';
    if (charCount(bio) > BIO_MAX) throw new InvalidAppearanceError(`Keep the bio to ${BIO_MAX} characters.`);
    data.bio = bio === '' ? null : bio;
  }

  if (input.socials !== undefined) {
    // Merged into what is stored: the editor sends a field at a time. Every
    // field is checked before anything is written, so one bad value saves none.
    const stored = await prisma.page.findUnique({ where: { accountId }, select: { socials: true } });
    const next = asSocials(stored?.socials);
    for (const kind of SOCIAL_KINDS) {
      const raw = input.socials[kind];
      if (raw === undefined) continue;
      const value = normalizeSocial(kind, raw);
      if (value === null) throw new InvalidAppearanceError(`That doesn't look like a ${SOCIAL_NAMES[kind]}.`);
      if (value === '') delete next[kind];
      else next[kind] = value;
    }
    data.socials = next;
  }

  // Prisma reports zero rows for an update with nothing in it, which would read as "no page".
  if (Object.keys(data).length > 0) {
    const updated = await prisma.page.updateMany({ where: { accountId }, data });
    if (updated.count !== 1) throw new NoPageError();
  }
  const page = await prisma.page.findUnique({
    where: { accountId },
    select: { style: true, background: true, backgroundColor: true, accentColor: true, headingFont: true, displayName: true, bio: true, socials: true },
  });
  if (!page) throw new NoPageError();
  return { ...page, socials: asSocials(page.socials) };
}
