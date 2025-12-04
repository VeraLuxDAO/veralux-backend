-- CreateTable
CREATE TABLE "public"."User" (
    "id" TEXT NOT NULL,
    "suiAddress" TEXT NOT NULL,
    "provider" TEXT,
    "username" TEXT,
    "bio" TEXT,
    "profileBlobId" TEXT,
    "refreshToken" TEXT,
    "lastLoginAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_suiAddress_key" ON "public"."User"("suiAddress");

-- CreateIndex
CREATE INDEX "User_suiAddress_idx" ON "public"."User"("suiAddress");

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

-- AddForeignKey
ALTER TABLE "public"."Flow" ADD CONSTRAINT "Flow_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Glow" ADD CONSTRAINT "Glow_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Promote" ADD CONSTRAINT "Promote_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Membership" ADD CONSTRAINT "Membership_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
