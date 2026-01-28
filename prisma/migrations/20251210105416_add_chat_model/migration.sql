-- CreateTable
CREATE TABLE "public"."Chat" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "blobId" TEXT NOT NULL,
    "patchId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT,

    CONSTRAINT "Chat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Chat_groupId_idx" ON "public"."Chat"("groupId");

-- CreateIndex
CREATE INDEX "Chat_actorId_idx" ON "public"."Chat"("actorId");

-- CreateIndex
CREATE INDEX "Chat_createdAt_idx" ON "public"."Chat"("createdAt");

-- AddForeignKey
ALTER TABLE "public"."Chat" ADD CONSTRAINT "Chat_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
