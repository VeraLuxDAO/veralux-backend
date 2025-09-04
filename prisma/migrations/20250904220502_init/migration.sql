-- CreateEnum
CREATE TYPE "public"."FlowType" AS ENUM ('TEXT', 'IMAGE');

-- CreateTable
CREATE TABLE "public"."Flow" (
    "id" TEXT NOT NULL,
    "type" "public"."FlowType" NOT NULL,
    "walrusHash" TEXT NOT NULL,
    "imageHash" TEXT,
    "mime" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "authorId" TEXT,

    CONSTRAINT "Flow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Glow" (
    "id" TEXT NOT NULL,
    "flowHash" TEXT NOT NULL,
    "walrusHash" TEXT NOT NULL,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Glow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Promote" (
    "id" TEXT NOT NULL,
    "flowHash" TEXT NOT NULL,
    "walrusHash" TEXT NOT NULL,
    "visibilityBoost" INTEGER NOT NULL DEFAULT 10,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Promote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Group" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Membership" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Flow_walrusHash_key" ON "public"."Flow"("walrusHash");

-- CreateIndex
CREATE INDEX "Glow_flowHash_idx" ON "public"."Glow"("flowHash");

-- CreateIndex
CREATE INDEX "Promote_flowHash_idx" ON "public"."Promote"("flowHash");

-- CreateIndex
CREATE UNIQUE INDEX "Group_groupId_key" ON "public"."Group"("groupId");

-- CreateIndex
CREATE INDEX "Membership_groupId_idx" ON "public"."Membership"("groupId");
