/**
 * Circles Routes
 * Handles private circle management (invite codes, members, access control)
 */

import { Router } from "express";
import { PrismaClient } from "@prisma/client";
import { createLogger } from "../logger.js";
import { requireAuth } from "../auth.js";
import {
  AppError,
  NotFoundError,
  ValidationError,
  AuthorizationError,
  handlePrismaError,
  asyncHandler
} from "../error-handler.js";

const logger = createLogger("circles-routes");
const router = Router();

/**
 * GET /circles/:groupId - Get circle details with invite code
 * Only authenticated members or creator can access
 */
router.get("/:groupId", requireAuth, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const groupId = req.params.groupId;

    const prisma = res.app.get("prisma") as PrismaClient;

    // Get circle
    const circle = await prisma.group.findUnique({
      where: { groupId }
    });

    if (!circle) {
      return res.status(404).json({ ok: false, error: "Circle not found" });
    }

    if (circle.type !== "circle") {
      return res.status(400).json({
        ok: false,
        error: "This endpoint is only for circles"
      });
    }

    // Check if user is member or creator
    const isMember = await prisma.membership.findFirst({
      where: { memberId: userId, groupId }
    });

    if (!isMember && (circle as any).creatorId !== userId) {
      return res.status(403).json({
        ok: false,
        error: "You are not a member of this circle"
      });
    }

    // Get member count
    const memberCount = await prisma.membership.count({ where: { groupId } });

    const response: any = {
      ok: true,
      circle: {
        id: circle.id,
        name: circle.name,
        description: (circle as any).description,
        type: circle.type,
        creatorId: (circle as any).creatorId,
        membersCount: memberCount,
        createdAt: circle.createdAt?.toISOString()
      }
    };

    // Only show invite code to creator
    if ((circle as any).creatorId === userId) {
      response.inviteCode = (circle as any).inviteCode;
    }

    res.json(response);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /circles/:groupId/invite-code - Get circle invite code
 * Only creator can view
 */
router.get("/:groupId/invite-code", requireAuth, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const groupId = req.params.groupId;

    const prisma = res.app.get("prisma") as PrismaClient;

    // Get circle
    const circle = await prisma.group.findUnique({
      where: { id: groupId }
    });

    if (!circle) {
      return res.status(404).json({ ok: false, error: "Circle not found" });
    }

    if (circle.type !== "circle") {
      return res.status(400).json({
        ok: false,
        error: "This endpoint is only for circles"
      });
    }

    // Check if user is creator
    if ((circle as any).creatorId !== userId) {
      return res.status(403).json({
        ok: false,
        error: "Only circle creator can view invite code"
      });
    }

    res.json({
      ok: true,
      groupId,
      inviteCode: (circle as any).inviteCode
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /circles/:groupId/regenerate-invite-code - Regenerate invite code
 * Only creator can regenerate
 */
router.post("/:groupId/regenerate-invite-code", requireAuth, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const groupId = req.params.groupId;

    const prisma = res.app.get("prisma") as PrismaClient;

    // Get circle
    const circle = await prisma.group.findUnique({
      where: { id: groupId }
    });

    if (!circle) {
      return res.status(404).json({ ok: false, error: "Circle not found" });
    }

    if (circle.type !== "circle") {
      return res.status(400).json({
        ok: false,
        error: "This endpoint is only for circles"
      });
    }

    // Check if user is creator
    if ((circle as any).creatorId !== userId) {
      return res.status(403).json({
        ok: false,
        error: "Only circle creator can regenerate invite codes"
      });
    }

    // Generate new invite code
    const newInviteCode = generateInviteCode();

    // Update circle
    const updatedCircle = await prisma.group.update({
      where: { groupId },
      data: { inviteCode: newInviteCode } as any
    });

    logger.info("Invite code regenerated", { groupId, userId });

    res.json({
      ok: true,
      groupId,
      inviteCode: (updatedCircle as any).inviteCode
    });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /circles/:groupId/members/:memberId - Remove member from circle
 * Only creator can remove members
 */
router.delete("/:groupId/members/:memberId", requireAuth, asyncHandler(async (req: any, res: any, next: any) => {
  try {
    const userId = req.user!.id;
    const groupId = req.params.groupId;
    const memberId = req.params.memberId;

    const prisma = res.app.get("prisma") as PrismaClient;

    try {
      // Get circle
      const circle = await prisma.group.findUnique({
        where: { id: groupId }
      });

      if (!circle) {
        throw new NotFoundError("Circle");
      }

      if (circle.type !== "circle") {
        throw new AppError("This endpoint is only for circles", 400);
      }

      // Check if user is creator
      if ((circle as any).creatorId !== userId) {
        throw new AuthorizationError("Only circle creator can remove members");
      }

      // Cannot remove creator
      if (memberId === (circle as any).creatorId) {
        throw new AppError("Cannot remove circle creator", 400);
      }

      // Check if member exists
      const membership = await prisma.membership.findFirst({
        where: { memberId: memberId, groupId }
      });

      if (!membership) {
        throw new NotFoundError("Member");
      }

      // Remove member
      await prisma.membership.delete({
        where: { id: membership.id }
      });

      logger.info("Member removed from circle", { groupId, memberId, removedBy: userId });

      res.json({
        ok: true,
        message: "Member removed from circle",
        groupId,
        memberId
      });
    } catch (err: any) {
      if (err instanceof AppError) throw err;
      throw handlePrismaError(err);
    }
  } catch (err) {
    next(err);
  }
}));

/**
 * POST /circles/:groupId/leave - Leave a circle
 * Any member can leave their own membership
 */
router.post("/:groupId/leave", requireAuth, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const groupId = req.params.groupId;

    const prisma = res.app.get("prisma") as PrismaClient;

    // Get circle
    const circle = await prisma.group.findUnique({
      where: { id: groupId }
    });

    if (!circle) {
      return res.status(404).json({ ok: false, error: "Circle not found" });
    }

    if (circle.type !== "circle") {
      return res.status(400).json({
        ok: false,
        error: "This endpoint is only for circles"
      });
    }

    // Cannot leave if creator
    if ((circle as any).creatorId === userId) {
      return res.status(400).json({
        ok: false,
        error: "Circle creator cannot leave. Delete the circle instead."
      });
    }

    // Check if user is member
    const membership = await prisma.membership.findFirst({
      where: { memberId: userId, groupId }
    });

    if (!membership) {
      return res.status(404).json({
        ok: false,
        error: "You are not a member of this circle"
      });
    }

    // Remove membership
    await prisma.membership.delete({
      where: { id: membership.id }
    });

    logger.info("User left circle", { groupId, userId });

    res.json({
      ok: true,
      message: "Left circle successfully",
      groupId
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Helper: Generate unique 6-character invite code
 */
function generateInviteCode(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

export default router;
