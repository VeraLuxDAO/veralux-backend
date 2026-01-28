/*
  Warnings:

  - A unique constraint covering the columns `[inviteCode]` on the table `Group` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "public"."Group" ADD COLUMN     "creatorId" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "inviteCode" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Group_inviteCode_key" ON "public"."Group"("inviteCode");

-- CreateIndex
CREATE INDEX "Group_type_idx" ON "public"."Group"("type");

-- CreateIndex
CREATE INDEX "Group_inviteCode_idx" ON "public"."Group"("inviteCode");

-- CreateIndex
CREATE INDEX "Group_creatorId_idx" ON "public"."Group"("creatorId");

-- AddForeignKey
ALTER TABLE "public"."Group" ADD CONSTRAINT "Group_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
