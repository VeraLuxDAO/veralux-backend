/**
 * User utilities: search, blocking, presence
 */
import { Router } from "express";
import { PrismaClient } from "@prisma/client";
import { requireAuth } from "../auth.js";
import { userSearchSchema } from "../validators.js";
import { ValidationError, NotFoundError, ConflictError, asyncHandler } from "../error-handler.js";
import { getStatus } from "../presence.js";

const router = Router();

// GET /users/search?query=...&limit=20
router.get("/search", requireAuth, asyncHandler(async (req: any, res: any) => {
  const parsed = userSearchSchema.safeParse({
    query: req.query.query,
    limit: req.query.limit
  });
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0].message);
  }

  const { query, limit } = parsed.data;
  const prisma = res.app.get("prisma") as PrismaClient;
  const requesterId = req.user!.id;

  // Get block lists
  const blocks = await (prisma as any).userBlock.findMany({ where: { blockerId: requesterId } });
  const blockedBy = await (prisma as any).userBlock.findMany({ where: { blockedId: requesterId } });
  const blockedIds = new Set([...blocks.map((b: any) => b.blockedId), ...blockedBy.map((b: any) => b.blockerId)]);

  const users = await prisma.user.findMany({
    where: {
      id: { not: requesterId },
      AND: [
        {
          OR: [
            { username: { contains: query, mode: "insensitive" } },
            { displayName: { contains: query, mode: "insensitive" } },
            { walletAddress: { contains: query, mode: "insensitive" } }
          ]
        }
      ]
    },
    take: limit,
    orderBy: { createdAt: "desc" }
  });

  res.json({
    ok: true,
    users: users
      .filter(u => !blockedIds.has(u.id))
      .map(u => ({
        id: u.id,
        walletAddress: u.walletAddress,
        username: u.username,
        displayName: u.displayName,
        avatarPatchId: u.avatarPatchId,
        status: getStatus(u.id).status
      }))
  });
}));

// POST /users/:userId/block
router.post("/:userId/block", requireAuth, asyncHandler(async (req: any, res: any) => {
  const blockerId = req.user!.id;
  const { userId } = req.params;
  if (blockerId === userId) throw new ValidationError("Cannot block yourself");

  const prisma = res.app.get("prisma") as PrismaClient;

  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) throw new NotFoundError("User");

  try {
    await (prisma as any).userBlock.create({ data: { blockerId, blockedId: userId } });
  } catch (err: any) {
    if (err.code === "P2002") throw new ConflictError("Already blocked");
    throw err;
  }

  res.json({ ok: true, blockedId: userId });
}));

// DELETE /users/:userId/block
router.delete("/:userId/block", requireAuth, asyncHandler(async (req: any, res: any) => {
  const blockerId = req.user!.id;
  const { userId } = req.params;
  const prisma = res.app.get("prisma") as PrismaClient;

  await (prisma as any).userBlock.deleteMany({ where: { blockerId, blockedId: userId } });
  res.json({ ok: true, unblockedId: userId });
}));

// GET /users/blocked
router.get("/blocked", requireAuth, asyncHandler(async (req: any, res: any) => {
  const userId = req.user!.id;
  const prisma = res.app.get("prisma") as PrismaClient;

  const blocked = await (prisma as any).userBlock.findMany({
    where: { blockerId: userId },
    include: { blocked: true }
  });

  res.json({
    ok: true,
    blocked: blocked.map((b: any) => ({
      id: b.blocked.id,
      walletAddress: b.blocked.walletAddress,
      username: b.blocked.username,
      displayName: b.blocked.displayName,
      avatarPatchId: b.blocked.avatarPatchId,
      blockedAt: b.createdAt.toISOString()
    }))
  });
}));

// GET /users/presence?userId=...
router.get("/presence", requireAuth, asyncHandler(async (req: any, res: any) => {
  const userId = req.query.userId as string;
  if (!userId) throw new ValidationError("userId is required");
  res.json({ ok: true, userId, ...getStatus(userId) });
}));

export default router;
