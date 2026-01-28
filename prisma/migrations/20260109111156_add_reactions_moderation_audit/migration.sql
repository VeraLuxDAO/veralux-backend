-- CreateTable
CREATE TABLE "public"."AuditLog" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "groupId" TEXT,
    "details" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."MessageReaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageReaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."MemberBan" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "bannedUserId" TEXT NOT NULL,
    "bannedBy" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemberBan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditLog_actorId_idx" ON "public"."AuditLog"("actorId");

-- CreateIndex
CREATE INDEX "AuditLog_targetId_idx" ON "public"."AuditLog"("targetId");

-- CreateIndex
CREATE INDEX "AuditLog_groupId_idx" ON "public"."AuditLog"("groupId");

-- CreateIndex
CREATE INDEX "AuditLog_timestamp_idx" ON "public"."AuditLog"("timestamp");

-- CreateIndex
CREATE INDEX "MessageReaction_messageId_idx" ON "public"."MessageReaction"("messageId");

-- CreateIndex
CREATE INDEX "MessageReaction_userId_idx" ON "public"."MessageReaction"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "MessageReaction_userId_messageId_emoji_key" ON "public"."MessageReaction"("userId", "messageId", "emoji");

-- CreateIndex
CREATE INDEX "MemberBan_groupId_bannedUserId_idx" ON "public"."MemberBan"("groupId", "bannedUserId");

-- CreateIndex
CREATE UNIQUE INDEX "MemberBan_groupId_bannedUserId_key" ON "public"."MemberBan"("groupId", "bannedUserId");

-- AddForeignKey
ALTER TABLE "public"."MessageReaction" ADD CONSTRAINT "MessageReaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MessageReaction" ADD CONSTRAINT "MessageReaction_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "public"."Chat"("id") ON DELETE CASCADE ON UPDATE CASCADE;
