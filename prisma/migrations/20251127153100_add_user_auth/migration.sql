/*
  Warnings:

  - You are about to drop the column `bio` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `profileBlobId` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `provider` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `refreshToken` on the `User` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "public"."Flow_authorId_idx";

-- DropIndex
DROP INDEX "public"."Flow_createdAt_idx";

-- DropIndex
DROP INDEX "public"."Glow_actorId_idx";

-- DropIndex
DROP INDEX "public"."Membership_memberId_idx";

-- DropIndex
DROP INDEX "public"."Promote_actorId_idx";

-- DropIndex
DROP INDEX "public"."User_suiAddress_idx";

-- AlterTable
ALTER TABLE "public"."Membership" ALTER COLUMN "memberId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "public"."User" DROP COLUMN "bio",
DROP COLUMN "profileBlobId",
DROP COLUMN "provider",
DROP COLUMN "refreshToken",
ADD COLUMN     "nonce" TEXT;
