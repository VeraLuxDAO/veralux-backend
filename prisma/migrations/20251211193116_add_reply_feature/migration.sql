-- AlterTable
ALTER TABLE "public"."Chat" ADD COLUMN     "replyToId" TEXT;

-- CreateIndex
CREATE INDEX "Chat_replyToId_idx" ON "public"."Chat"("replyToId");

-- AddForeignKey
ALTER TABLE "public"."Chat" ADD CONSTRAINT "Chat_replyToId_fkey" FOREIGN KEY ("replyToId") REFERENCES "public"."Chat"("id") ON DELETE SET NULL ON UPDATE CASCADE;
