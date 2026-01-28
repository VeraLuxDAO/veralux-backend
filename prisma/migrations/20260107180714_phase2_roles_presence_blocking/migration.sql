/*
  Warnings:

  - Added the required column `updatedAt` to the `Chat` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "public"."MemberRole" AS ENUM ('CREATOR', 'ADMIN', 'MODERATOR', 'MEMBER');

-- AlterTable
ALTER TABLE "public"."Chat" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "public"."Membership" ADD COLUMN     "role" "public"."MemberRole" NOT NULL DEFAULT 'MEMBER';

-- CreateTable
CREATE TABLE "public"."UserBlock" (
    "id" TEXT NOT NULL,
    "blockerId" TEXT NOT NULL,
    "blockedId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."MessageRead" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageRead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserBlock_blockerId_idx" ON "public"."UserBlock"("blockerId");

-- CreateIndex
CREATE INDEX "UserBlock_blockedId_idx" ON "public"."UserBlock"("blockedId");

-- CreateIndex
CREATE UNIQUE INDEX "UserBlock_blockerId_blockedId_key" ON "public"."UserBlock"("blockerId", "blockedId");

-- CreateIndex
CREATE INDEX "MessageRead_groupId_userId_idx" ON "public"."MessageRead"("groupId", "userId");

-- CreateIndex
CREATE INDEX "MessageRead_userId_readAt_idx" ON "public"."MessageRead"("userId", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "MessageRead_userId_messageId_key" ON "public"."MessageRead"("userId", "messageId");

-- CreateIndex
CREATE INDEX "Membership_groupId_role_idx" ON "public"."Membership"("groupId", "role");

-- AddForeignKey
ALTER TABLE "public"."UserBlock" ADD CONSTRAINT "UserBlock_blockerId_fkey" FOREIGN KEY ("blockerId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."UserBlock" ADD CONSTRAINT "UserBlock_blockedId_fkey" FOREIGN KEY ("blockedId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MessageRead" ADD CONSTRAINT "MessageRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MessageRead" ADD CONSTRAINT "MessageRead_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "public"."Chat"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
