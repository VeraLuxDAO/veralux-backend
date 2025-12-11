/**
 * Chat Routes & SSE Streaming
 * Handles real-time chat messages and event streaming
 */

import { Router, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { createLogger } from "../logger.js";
import { requireAuth } from "../auth.js";

const logger = createLogger("chat-routes");
const router = Router();

// SSE Client management
interface SSEClient {
  userId: string;
  response: Response;
  groupIds: Set<string>;
}

const sseClients = new Map<string, SSEClient>();

/**
 * POST /chat - Send a message
 * Message is saved to database and broadcast to SSE clients
 */
router.post("/", requireAuth, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const { groupId, text, content } = req.body;
    
    // Support both 'text' (new) and 'content' (legacy) field names
    const messageText = text || content;

    if (!groupId || typeof groupId !== "string") {
      return res.status(400).json({
        ok: false,
        error: "groupId is required and must be a string"
      });
    }

    if (!messageText || typeof messageText !== "string") {
      return res.status(400).json({
        ok: false,
        error: "text is required and must be a string"
      });
    }

    const prisma = res.app.get("prisma") as PrismaClient;

    // Get group
    const group = await prisma.group.findUnique({
      where: { id: groupId }
    });

    if (!group) {
      return res.status(404).json({
        ok: false,
        error: "Group not found"
      });
    }

    // For circles, check membership before allowing chat
    if (group.type === "circle") {
      const membership = await prisma.membership.findFirst({
        where: { memberId: userId, groupId }
      });

      if (!membership) {
        return res.status(403).json({
          ok: false,
          error: "You are not a member of this circle. Cannot send messages."
        });
      }
    } else {
      // For rooms, check if user is a member (auto-join if not)
      const membership = await prisma.membership.findFirst({
        where: { memberId: userId, groupId }
      });

      if (!membership) {
        await prisma.membership.create({
          data: { memberId: userId, groupId }
        });
      }
    }

    // Save message
    const message = await prisma.chat.create({
      data: {
        text: messageText.trim(),
        actorId: userId,
        groupId,
        blobId: "placeholder",
        patchId: `chat-${Date.now()}`
      },
      include: {
        actor: {
          select: {
            id: true,
            walletAddress: true,
            username: true,
            displayName: true,
            avatarPatchId: true
          }
        }
      }
    });

    // Broadcast to SSE clients in this group
    broadcast({
      type: "message",
      groupId,
      message: {
        id: message.id,
        text: message.text,
        actorId: message.actorId,
        groupId: message.groupId,
        actor: message.actor,
        createdAt: message.createdAt.toISOString()
      }
    });

    logger.info("Message sent", { userId, groupId, messageId: message.id });

    res.json({
      ok: true,
      message: {
        id: message.id,
        text: message.text,
        actorId: message.actorId,
        groupId: message.groupId,
        actor: message.actor,
        createdAt: message.createdAt.toISOString()
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /chat/:groupId - Get chat history for a group
 * For circles, only members can access
 */
router.get("/:groupId", requireAuth, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const groupId = req.params.groupId;
    const limit = Math.min(100, parseInt(req.query.limit as string) || 50);
    const offset = Math.max(0, parseInt(req.query.offset as string) || 0);

    const prisma = res.app.get("prisma") as PrismaClient;

    // Get group
    const group = await prisma.group.findUnique({
      where: { id: groupId }
    });

    if (!group) {
      return res.status(404).json({
        ok: false,
        error: "Group not found"
      });
    }

    // For circles, check membership
    if (group.type === "circle") {
      const membership = await prisma.membership.findFirst({
        where: { memberId: userId, groupId }
      });

      if (!membership) {
        return res.status(403).json({
          ok: false,
          error: "You are not a member of this circle. Cannot access messages."
        });
      }
    }

    // Get messages
    const messages = await prisma.chat.findMany({
      where: { groupId },
      include: {
        actor: {
          select: {
            id: true,
            walletAddress: true,
            username: true,
            displayName: true,
            avatarPatchId: true
          }
        }
      },
      take: limit,
      skip: offset,
      orderBy: { createdAt: "asc" }
    });

    const total = await prisma.chat.count({ where: { groupId } });

    // Format messages
    const formattedMessages = messages.map(m => ({
      id: m.id,
      text: m.text,
      actorId: m.actorId,
      groupId: m.groupId,
      actor: m.actor,
      createdAt: m.createdAt.toISOString()
    }));

    res.json({
      ok: true,
      groupId,
      messages: formattedMessages,
      pagination: {
        offset,
        limit,
        total
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /events - SSE endpoint for real-time updates
 * Client connects and receives messages for groups they're members of
 */
router.get("/events/subscribe", requireAuth, (req, res, next) => {
  try {
    const userId = req.user!.id;

    // Set SSE headers
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*"
    });

    // Create client entry
    const clientId = `${userId}-${Date.now()}`;
    const sseClient: SSEClient = {
      userId,
      response: res,
      groupIds: new Set()
    };

    sseClients.set(clientId, sseClient);
    logger.info("SSE client connected", { clientId, userId });

    // Send initial connection confirmation
    res.write(`data: ${JSON.stringify({ type: "connected", userId })}\n\n`);

    // Handle client disconnect
    req.on("close", () => {
      sseClients.delete(clientId);
      logger.info("SSE client disconnected", { clientId, userId });
    });

    res.on("error", () => {
      sseClients.delete(clientId);
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /events/subscribe-group - Subscribe to group events
 * Called by client after connecting to SSE
 */
router.post("/events/subscribe-group", requireAuth, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const { groupId } = req.body;

    if (!groupId) {
      return res.status(400).json({
        ok: false,
        error: "groupId is required"
      });
    }

    const prisma = res.app.get("prisma") as PrismaClient;

    // Verify user is member of group
    const membership = await prisma.membership.findFirst({
      where: { memberId: userId, groupId }
    });

    if (!membership) {
      return res.status(403).json({
        ok: false,
        error: "You are not a member of this group"
      });
    }

    // Add group to all user's SSE connections
    for (const [, client] of sseClients) {
      if (client.userId === userId) {
        client.groupIds.add(groupId);
      }
    }

    logger.info("User subscribed to group events", { userId, groupId });

    res.json({
      ok: true,
      message: "Subscribed to group",
      groupId
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /events/unsubscribe-group - Unsubscribe from group events
 */
router.post("/events/unsubscribe-group", requireAuth, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const { groupId } = req.body;

    if (!groupId) {
      return res.status(400).json({
        ok: false,
        error: "groupId is required"
      });
    }

    // Remove group from all user's SSE connections
    for (const [, client] of sseClients) {
      if (client.userId === userId) {
        client.groupIds.delete(groupId);
      }
    }

    logger.info("User unsubscribed from group events", { userId, groupId });

    res.json({
      ok: true,
      message: "Unsubscribed from group",
      groupId
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Broadcast event to all SSE clients in a group
 */
function broadcast(event: any) {
  const eventData = `data: ${JSON.stringify(event)}\n\n`;

  for (const [, client] of sseClients) {
    if (client.groupIds.has(event.groupId)) {
      try {
        client.response.write(eventData);
      } catch (err) {
        logger.error("Failed to broadcast to client", { error: err });
      }
    }
  }
}

// Export broadcast for use by other routes
export { broadcast };

export default router;
