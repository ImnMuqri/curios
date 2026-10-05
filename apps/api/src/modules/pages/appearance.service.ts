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
}

export async function updateAppearance(
  prisma: PrismaClient,
  accountId: string,
  input: Partial<Omit<Appearance, 'bio'>> & { bio?: string | null },
): Promise<Appearance> {
  const data: Partial<Appearance> = {};
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

  const updated = await prisma.page.updateMany({ where: { accountId }, data });
  if (updated.count !== 1) throw new NoPageError();
  return prisma.page.findUniqueOrThrow({
    where: { accountId },
    select: { style: true, background: true, backgroundColor: true, accentColor: true, headingFont: true, displayName: true, bio: true },
  });
}
