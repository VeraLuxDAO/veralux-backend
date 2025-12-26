/**
 * Groups Routes (Rooms & Circles)
 * Handles group creation and joining
 */

import { Router } from "express";
import { PrismaClient } from "@prisma/client";
import { createLogger } from "../logger.js";
import { requireAuth } from "../auth.js";
import { create_group } from "../blockchain.js";
import {
  AppError,
  NotFoundError,
  ConflictError,
  ValidationError,
  AuthorizationError,
  handlePrismaError,
  asyncHandler
} from "../error-handler.js";

const logger = createLogger("groups-routes");
const router = Router();

/**
 * Helper: Convert Group model to Group response
 * Note: membersCount will be 0 unless explicitly set
 */
function toGroupResponse(group: any, membersCount?: number) {
  return {
    id: group.id,
    name: group.name,
    description: (group as any).description,
    type: group.type,
    creatorId: (group as any).creatorId,
    createdAt: group.createdAt?.toISOString() ?? new Date().toISOString(),
    membersCount: membersCount ?? 0,
    hasInviteCode: !!(group as any).inviteCode
  };
}

/**
 * GET /groups - Get all available groups
 * Returns public rooms and circles the user created or is a member of
 * If not authenticated, returns only public rooms
 */
router.get("/", async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(50, parseInt(req.query.limit as string) || 20);
    const skip = (page - 1) * limit;
    const userId = (req as any).user?.id;

    const prisma = res.app.get("prisma") as PrismaClient;

    let groups;
    let total;
    
    if (userId) {
      // For authenticated users: show all rooms + circles they created or are members of
      const memberships = await prisma.membership.findMany({
        where: { memberId: userId },
        select: { groupId: true }
      });
      const memberGroupIds = memberships.map(m => m.groupId);
      
      // Cast creatorId to any to work around Prisma type cache issues
      groups = await prisma.group.findMany({
        where: {
          OR: [
            { type: "room" },
            { type: "circle", creatorId: userId as any },
            { type: "circle", id: { in: memberGroupIds } }
          ]
        },
        take: limit,
        skip,
        orderBy: { createdAt: "desc" }
      });
      
      total = await prisma.group.count({
        where: {
          OR: [
            { type: "room" },
            { type: "circle", creatorId: userId as any },
            { type: "circle", id: { in: memberGroupIds } }
          ]
        }
      });
    } else {
      // For unauthenticated users: show only public rooms
      groups = await prisma.group.findMany({
        where: { type: "room" },
        take: limit,
        skip,
        orderBy: { createdAt: "desc" }
      });
      
      total = await prisma.group.count({ where: { type: "room" } });
    }

    res.json({
      ok: true,
      groups: groups.map(toGroupResponse),
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /groups/:groupId - Get group details
 * Anyone can view public group details
 */
router.get("/:groupId", async (req, res, next) => {
  try {
    const groupId = req.params.groupId;
    const prisma = res.app.get("prisma") as PrismaClient;

    const group = await prisma.group.findUnique({
      where: { groupId }
    });
    if (!group) {
      return res.status(404).json({ ok: false, error: "Group not found" });
    }

    res.json({
      ok: true,
      group: toGroupResponse(group)
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /groups/rooms - Create a new public room
 * Authenticated users can create rooms
 */
router.post("/rooms", requireAuth, asyncHandler(async (req: any, res: any, next: any) => {
  try {
    const userId = req.user!.id;
    const { name, description } = req.body;

    if (!name || typeof name !== "string") {
      throw new ValidationError("name is required and must be a string");
    }

    const prisma = res.app.get("prisma") as PrismaClient;

    try {
      // Create room on blockchain first
      const created = await create_group("room", name.trim());
      
      // Create room in database
      const group = await prisma.group.create({
        data: {
          groupId: created.chainGroupId,
          name: name.trim(),
          description: description?.trim() || "",
          type: "room",
          creatorId: userId
        } as any
      });

      // Add creator as first member
      await prisma.membership.create({
        data: {
          memberId: userId,
          groupId: group.id
        }
      });

      logger.info("Room created", { groupId: group.id, userId, name });

      res.status(201).json({
        ok: true,
        group: toGroupResponse(group)
      });
    } catch (err: any) {
      throw handlePrismaError(err);
    }
  } catch (err) {
    next(err);
  }
}));

/**
 * POST /groups/circles - Create a new private circle
 * Authenticated users can create circles
 * Returns invite code for circle
 */
router.post("/circles", requireAuth, asyncHandler(async (req: any, res: any, next: any) => {
  try {
    const userId = req.user!.id;
    const { name, description } = req.body;

    if (!name || typeof name !== "string") {
      throw new ValidationError("name is required and must be a string");
    }

    const prisma = res.app.get("prisma") as PrismaClient;

    try {
      // Generate unique invite code
      const inviteCode = generateInviteCode();

      // Create circle on blockchain first
      const created = await create_group("circle", name.trim());
      
      // Create circle in database
      const group = await prisma.group.create({
        data: {
          groupId: created.chainGroupId,
          name: name.trim(),
          description: description?.trim() || "",
          type: "circle",
          creatorId: userId,
          inviteCode
        } as any
      });

      // Add creator as first member
      await prisma.membership.create({
        data: {
          memberId: userId,
          groupId: group.id
        }
      });

      logger.info("Circle created", { groupId: group.id, userId, name });

      res.status(201).json({
        ok: true,
        group: toGroupResponse(group),
        inviteCode
      });
    } catch (err: any) {
      throw handlePrismaError(err);
    }
  } catch (err) {
    next(err);
  }
}));

/**
 * POST /groups/join - Join a group
 * For rooms: no invite code needed
 * For circles: invite code is required
 */
router.post("/join", requireAuth, asyncHandler(async (req: any, res: any, next: any) => {
  try {
    const userId = req.user!.id;
    const { groupId, inviteCode } = req.body;

    if (!groupId || typeof groupId !== "string") {
      throw new ValidationError("groupId is required and must be a string");
    }

    const prisma = res.app.get("prisma") as PrismaClient;

    try {
      // Get group
      const group = await prisma.group.findUnique({
        where: { id: groupId }
      });

      if (!group) {
        throw new NotFoundError("Group");
      }

      // Check if user is already a member
      const existingMembership = await prisma.membership.findFirst({
        where: { memberId: userId, groupId }
      });

      if (existingMembership) {
        throw new ConflictError("You are already a member of this group");
      }

      // For circles, validate invite code
      if (group.type === "circle") {
        if (!inviteCode || inviteCode !== (group as any).inviteCode) {
          throw new AuthorizationError("Invalid invite code for circle");
        }
      }

      // Create membership
      await prisma.membership.create({
        data: {
          memberId: userId,
          groupId
        }
      });

      logger.info("User joined group", { userId, groupId, groupType: group.type });

      res.json({
        ok: true,
        message: `Joined ${group.name}`,
        groupId
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
 * GET /groups/:groupId/members - Get group members
 * Only group creator/admin can view
 */
router.get("/:groupId/members", requireAuth, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const groupId = req.params.groupId;

    const prisma = res.app.get("prisma") as PrismaClient;

    // Get group
    const group = await prisma.group.findUnique({
      where: { id: groupId }
    });

    if (!group) {
      return res.status(404).json({ ok: false, error: "Group not found" });
    }

    // Check if user is creator
    if ((group as any).creatorId !== userId) {
      return res.status(403).json({
        ok: false,
        error: "Only group creator can view members"
      });
    }

    // Get members
    const members = await prisma.membership.findMany({
      where: { groupId },
      include: {
        member: {
          select: {
            id: true,
            walletAddress: true,
            username: true,
            displayName: true,
            avatarPatchId: true
          }
        }
      },
      orderBy: { createdAt: "asc" }
    });

    res.json({
      ok: true,
      groupId,
      memberCount: members.length,
      members: members.map(m => ({
        id: m.member?.id,
        walletAddress: m.member?.walletAddress,
        username: m.member?.username,
        displayName: m.member?.displayName,
        avatarPatchId: m.member?.avatarPatchId,
        joinedAt: m.createdAt?.toISOString()
      }))
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
