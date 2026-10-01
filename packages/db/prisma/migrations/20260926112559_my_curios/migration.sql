-- CreateEnum
CREATE TYPE "TileSize" AS ENUM ('SMALL', 'WIDE', 'TALL', 'BIG');

-- CreateEnum
CREATE TYPE "PageStyle" AS ENUM ('SOFT', 'CONTRAST');

-- CreateEnum
CREATE TYPE "HeadingFont" AS ENUM ('JAKARTA', 'BRICOLAGE', 'FRAUNCES', 'SPACE_GROTESK', 'DM_SERIF', 'OUTFIT');

-- AlterTable
ALTER TABLE "Link" ADD COLUMN     "size" "TileSize";

-- AlterTable
ALTER TABLE "Page" ADD COLUMN     "accentColor" TEXT NOT NULL DEFAULT '#0c7a62',
ADD COLUMN     "avatarKey" TEXT,
ADD COLUMN     "headingFont" "HeadingFont" NOT NULL DEFAULT 'JAKARTA',
ADD COLUMN     "style" "PageStyle" NOT NULL DEFAULT 'SOFT';
