/*
  Warnings:

  - You are about to drop the column `suiAddress` on the `User` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[walletAddress]` on the table `User` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[username]` on the table `User` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[refreshToken]` on the table `User` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `updatedAt` to the `User` table without a default value. This is not possible if the table is not empty.
  - Added the required column `walletAddress` to the `User` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "public"."User_suiAddress_key";

-- AlterTable
ALTER TABLE "public"."User" DROP COLUMN "suiAddress",
ADD COLUMN     "avatarBlobId" TEXT,
ADD COLUMN     "avatarPatchId" TEXT,
ADD COLUMN     "bio" TEXT,
ADD COLUMN     "displayName" TEXT,
ADD COLUMN     "nonceExpiresAt" TIMESTAMP(3),
ADD COLUMN     "refreshToken" TEXT,
ADD COLUMN     "refreshTokenExpiresAt" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "walletAddress" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "Flow_authorId_idx" ON "public"."Flow"("authorId");

-- CreateIndex
CREATE INDEX "Flow_createdAt_idx" ON "public"."Flow"("createdAt");

-- CreateIndex
CREATE INDEX "Glow_actorId_idx" ON "public"."Glow"("actorId");

-- CreateIndex
CREATE INDEX "Membership_memberId_idx" ON "public"."Membership"("memberId");

-- CreateIndex
CREATE INDEX "Promote_actorId_idx" ON "public"."Promote"("actorId");

-- CreateIndex
CREATE UNIQUE INDEX "User_walletAddress_key" ON "public"."User"("walletAddress");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "public"."User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_refreshToken_key" ON "public"."User"("refreshToken");

-- CreateIndex
CREATE INDEX "User_walletAddress_idx" ON "public"."User"("walletAddress");
