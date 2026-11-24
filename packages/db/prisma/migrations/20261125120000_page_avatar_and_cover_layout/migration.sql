-- My Curios: the picture's size and border, and where the cover sits. Every existing page keeps
-- today's look: a medium picture with its ring, the cover as a band at the top.
CREATE TYPE "AvatarSize" AS ENUM ('SMALL', 'MEDIUM', 'LARGE');
CREATE TYPE "CoverLayout" AS ENUM ('TOP', 'FULL');
ALTER TABLE "Page" ADD COLUMN "avatarSize" "AvatarSize" NOT NULL DEFAULT 'MEDIUM';
ALTER TABLE "Page" ADD COLUMN "avatarBorder" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Page" ADD COLUMN "coverLayout" "CoverLayout" NOT NULL DEFAULT 'TOP';
