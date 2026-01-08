/**
 * Chat Routes & SSE Streaming
 * Handles real-time chat messages and event streaming
 */

import { Router, Response } from "express";
import { z } from "zod";
import { PrismaClient } from "@prisma/client";
import { createLogger } from "../logger.js";
import { requireAuth } from "../auth.js";
import { sanitizeInput } from "../sanitizer.js";
import { paginationSchema } from "../validators.js";
import { setOnline, setOffline, touch } from "../presence.js";
import {
  AppError,
  NotFoundError,
  ValidationError,
  AuthorizationError,
  handlePrismaError,
  asyncHandler
} from "../error-handler.js";

const logger = createLogger("chat-routes");
const router = Router();

// SSE Client management
interface SSEClient {
  userId: string;
  response: Response;
  groupIds: Set<string>;
  lastEventId: number;
  heartbeat?: NodeJS.Timeout;
}

const sseClients = new Map<string, SSEClient>();
let nextEventId = 1;
const eventBuffer: Array<{ id: number; groupId?: string; payload: any }> = [];
const MAX_BUFFER = 200;

/**
 * POST /chat - Send a message
 * Message is saved to database and broadcast to SSE clients
 */
router.post("/", requireAuth, asyncHandler(async (req: any, res: any, next: any) => {
  try {
    const userId = req.user!.id;
    const { groupId, text, content, replyToId } = req.body;
    
    // Support both 'text' (new) and 'content' (legacy) field names
    const messageText = text || content;

    if (!groupId || typeof groupId !== "string") {
      throw new ValidationError("groupId is required and must be a string");
    }

    if (!messageText || typeof messageText !== "string") {
      throw new ValidationError("text is required and must be a string");
    }

    // Validate message length
    if (messageText.trim().length === 0) {
      throw new ValidationError("Message cannot be empty");
    }

    if (messageText.length > 2000) {
      throw new ValidationError("Message cannot exceed 2000 characters");
    }

    // Sanitize message text
    const sanitizedText = sanitizeInput(messageText, {
      maxLength: 2000,
      allowHtml: false,
      stripTags: true,
      normalizeSpace: false,
    });

    // Validate replyToId if provided
    if (replyToId && typeof replyToId !== "string") {
      throw new ValidationError("replyToId must be a string");
    }

    const prisma = res.app.get("prisma") as PrismaClient;

    // Get group
    const group = await prisma.group.findUnique({
      where: { id: groupId }
    });

    if (!group) {
      throw new NotFoundError("Group");
    }

    // For circles, check membership before allowing chat
    if (group.type === "circle") {
      const membership = await prisma.membership.findFirst({
        where: { memberId: userId, groupId }
      });

      if (!membership) {
        throw new AuthorizationError("You are not a member of this circle. Cannot send messages.");
      }
    } else {
      // For rooms, check if user is a member (auto-join if not)
      const membership = await prisma.membership.findFirst({
        where: { memberId: userId, groupId }
      });

      if (!membership) {
        try {
          await prisma.membership.create({
            data: { memberId: userId, groupId }
          });
        } catch (err: any) {
          throw handlePrismaError(err);
        }
      }
    }

    // Save message
    let message;
    try {
      message = await prisma.chat.create({
        data: {
          text: sanitizedText,
          actorId: userId,
          groupId,
          blobId: "placeholder",
          patchId: `chat-${Date.now()}`,
          ...(replyToId && { replyToId })
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
          },
          replyTo: {
            select: {
              id: true,
              text: true,
              actorId: true,
              createdAt: true,
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
          }
        }
      } as any);
    } catch (err: any) {
      throw handlePrismaError(err);
    }

    // Broadcast to SSE clients in this group
    const msg = message as any;
    broadcast({
      type: "message",
      groupId,
      message: {
        id: msg.id,
        text: msg.text,
        actorId: msg.actorId,
        groupId: msg.groupId,
        actor: msg.actor,
        replyToId: msg.replyToId,
        replyTo: msg.replyTo ? {
          id: msg.replyTo.id,
          text: msg.replyTo.text,
          actorId: msg.replyTo.actorId,
          actor: msg.replyTo.actor,
          createdAt: msg.replyTo.createdAt.toISOString()
        } : null,
        createdAt: msg.createdAt.toISOString()
      }
    });

    logger.info("Message sent", { userId, groupId, messageId: msg.id, replyToId: msg.replyToId });

    res.json({
      ok: true,
      message: {
        id: msg.id,
        text: msg.text,
        actorId: msg.actorId,
        groupId: msg.groupId,
        actor: msg.actor,
        replyToId: msg.replyToId,
        replyTo: msg.replyTo ? {
          id: msg.replyTo.id,
          text: msg.replyTo.text,
          actorId: msg.replyTo.actorId,
          actor: msg.replyTo.actor,
          createdAt: msg.replyTo.createdAt.toISOString()
        } : null,
        createdAt: msg.createdAt.toISOString()
      }
    });
  } catch (err) {
    next(err);
  }
}));

/**
 * GET /chat/:groupId - Get chat history for a group
 * For circles, only members can access
 * Supports pagination with limit/offset
 */
router.get("/:groupId", requireAuth, asyncHandler(async (req: any, res: any, next: any) => {
  try {
    const userId = req.user!.id;
    const groupId = req.params.groupId;

    // Validate pagination parameters
    const paginationResult = paginationSchema.safeParse({
      limit: req.query.limit,
      offset: req.query.offset
    });

    if (!paginationResult.success) {
      throw new ValidationError(paginationResult.error.issues[0].message);
    }

    const { limit = 20, offset = 0 } = paginationResult.data;
    const finalLimit = Math.min(limit, 100); // Max 100 per request

    const prisma = res.app.get("prisma") as PrismaClient;

    // Get group
    const group = await prisma.group.findUnique({
      where: { id: groupId }
    });

    if (!group) {
      throw new NotFoundError("Group");
    }

    // For circles, check membership
    if (group.type === "circle") {
      const membership = await prisma.membership.findFirst({
        where: { memberId: userId, groupId }
      });

      if (!membership) {
        throw new AuthorizationError("You are not a member of this circle. Cannot access messages.");
      }
    }

    // Get messages with pagination
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
        },
        replyTo: {
          select: {
            id: true,
            text: true,
            actorId: true,
            createdAt: true,
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
        }
      } as any,
      take: finalLimit,
      skip: offset,
      orderBy: { createdAt: "asc" }
    });

    // Get total count (cached if possible)
    const total = await prisma.chat.count({ where: { groupId } });

    // Format messages
    const formattedMessages = messages.map((m: any) => ({
      id: m.id,
      text: m.text,
      actorId: m.actorId,
      groupId: m.groupId,
      actor: m.actor,
      replyToId: m.replyToId,
      replyTo: m.replyTo ? {
        id: m.replyTo.id,
        text: m.replyTo.text,
        actorId: m.replyTo.actorId,
        actor: m.replyTo.actor,
        createdAt: m.replyTo.createdAt.toISOString()
      } : null,
      createdAt: m.createdAt.toISOString(),
      updatedAt: m.updatedAt?.toISOString()
    }));

    res.json({
      ok: true,
      groupId,
      messages: formattedMessages,
      pagination: {
        offset,
        limit: finalLimit,
        total,
        hasMore: offset + finalLimit < total
      }
    });
  } catch (err) {
    next(err);
  }
}));

/**
 * PATCH /chat/:messageId - Edit a message
 * Only message author can edit
 */
router.patch("/:messageId", requireAuth, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const messageId = req.params.messageId;
    const { text } = req.body;

    if (!text || typeof text !== "string") {
      return res.status(400).json({
        ok: false,
        error: "text is required and must be a string"
      });
    }

    const prisma = res.app.get("prisma") as PrismaClient;

    // Get message
    const message = await prisma.chat.findUnique({
      where: { id: messageId }
    });

    if (!message) {
      return res.status(404).json({
        ok: false,
        error: "Message not found"
      });
    }

    // Check if user is the author
    if (message.actorId !== userId) {
      return res.status(403).json({
        ok: false,
        error: "Only message author can edit"
      });
    }

    // Update message
    const updatedMessage = await prisma.chat.update({
      where: { id: messageId },
      data: { text: text.trim() },
      include: {
        actor: {
          select: {
            id: true,
            walletAddress: true,
            username: true,
            displayName: true,
            avatarPatchId: true
          }
        },
        replyTo: {
          select: {
            id: true,
            text: true,
            actorId: true,
            createdAt: true,
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
        }
      }
    } as any);

    const msg = updatedMessage as any;

    // Broadcast edit event
    broadcast({
      type: "message-edited",
      groupId: msg.groupId,
      message: {
        id: msg.id,
        text: msg.text,
        actorId: msg.actorId,
        groupId: msg.groupId,
        actor: msg.actor,
        replyToId: msg.replyToId,
        replyTo: msg.replyTo ? {
          id: msg.replyTo.id,
          text: msg.replyTo.text,
          actorId: msg.replyTo.actorId,
          actor: msg.replyTo.actor,
          createdAt: msg.replyTo.createdAt.toISOString()
        } : null,
        createdAt: msg.createdAt.toISOString(),
        updatedAt: msg.updatedAt?.toISOString()
      }
    });

    logger.info("Message edited", { userId, messageId });

    res.json({
      ok: true,
      message: {
        id: msg.id,
        text: msg.text,
        actorId: msg.actorId,
        groupId: msg.groupId,
        actor: msg.actor,
        replyToId: msg.replyToId,
        replyTo: msg.replyTo ? {
          id: msg.replyTo.id,
          text: msg.replyTo.text,
          actorId: msg.replyTo.actorId,
          actor: msg.replyTo.actor,
          createdAt: msg.replyTo.createdAt.toISOString()
        } : null,
        createdAt: msg.createdAt.toISOString(),
        updatedAt: msg.updatedAt?.toISOString()
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /chat/:messageId - Delete a message
 * Only message author can delete
 */
router.delete("/:messageId", requireAuth, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const messageId = req.params.messageId;

    const prisma = res.app.get("prisma") as PrismaClient;

    // Get message
    const message = await prisma.chat.findUnique({
      where: { id: messageId }
    });

    if (!message) {
      return res.status(404).json({
        ok: false,
        error: "Message not found"
      });
    }

    // Check if user is the author
    if (message.actorId !== userId) {
      return res.status(403).json({
        ok: false,
        error: "Only message author can delete"
      });
    }

    const groupId = message.groupId;

    // Delete message
    await prisma.chat.delete({
      where: { id: messageId }
    });

    // Broadcast delete event
    broadcast({
      type: "message-deleted",
      groupId,
      messageId,
      deletedAt: new Date().toISOString()
    });

    logger.info("Message deleted", { userId, messageId });

    res.json({
      ok: true,
      message: "Message deleted successfully",
      messageId
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
    const lastEventIdHeader = req.headers["last-event-id"] as string | undefined;
    const lastEventId = lastEventIdHeader ? Number(lastEventIdHeader) || 0 : 0;

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
      groupIds: new Set(),
      lastEventId
    };

    sseClients.set(clientId, sseClient);
    logger.info("SSE client connected", { clientId, userId });

    // Presence: mark online
    setOnline(userId);
    broadcast({ type: "presence", userId, status: "online", ts: Date.now() });

    // Send initial connection confirmation
    res.write(`id: ${nextEventId++}\n` + `data: ${JSON.stringify({ type: "connected", userId })}\n\n`);

    // Heartbeat
    sseClient.heartbeat = setInterval(() => {
      touch(userId);
      try {
        res.write(`: ping ${Date.now()}\n\n`);
      } catch (err) {
        clearInterval(sseClient.heartbeat!);
      }
    }, 25_000);

    // Handle client disconnect
    req.on("close", () => {
      if (sseClient.heartbeat) clearInterval(sseClient.heartbeat);
      sseClients.delete(clientId);
      setOffline(userId);
      broadcast({ type: "presence", userId, status: "offline", ts: Date.now() });
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
        replayBuffered(client, groupId);
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
 * POST /chat/:groupId/typing - Typing indicators
 */
router.post("/:groupId/typing", requireAuth, asyncHandler(async (req: any, res: any, next: any) => {
  try {
    const userId = req.user!.id;
    const { groupId } = req.params;
    const { status } = req.body as { status?: string };

    if (!status || !["start", "stop"].includes(status)) {
      throw new ValidationError("status must be 'start' or 'stop'");
    }

    const prisma = res.app.get("prisma") as PrismaClient;
    const membership = await prisma.membership.findFirst({ where: { memberId: userId, groupId } });
    if (!membership) {
      throw new AuthorizationError("Not a member of this group");
    }

    broadcast({ type: "typing", userId, groupId, status, ts: Date.now() });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}));

/**
 * POST /chat/:groupId/read - Read receipts
 */
router.post("/:groupId/read", requireAuth, asyncHandler(async (req: any, res: any, next: any) => {
  try {
    const userId = req.user!.id;
    const { groupId } = req.params;
    const { messageId } = req.body as { messageId?: string };

    if (!messageId || typeof messageId !== "string") {
      throw new ValidationError("messageId is required");
    }

    const prisma = res.app.get("prisma") as PrismaClient;

    const membership = await prisma.membership.findFirst({ where: { memberId: userId, groupId } });
    if (!membership) throw new AuthorizationError("Not a member of this group");

    const message = await prisma.chat.findUnique({ where: { id: messageId } });
    if (!message || message.groupId !== groupId) throw new NotFoundError("Message");

    await (prisma as any).messageRead.upsert({
      where: { userId_messageId: { userId, messageId } },
      update: { readAt: new Date() },
      create: { userId, messageId, groupId, readAt: new Date() }
    });

    broadcast({ type: "read_receipt", userId, groupId, messageId, ts: Date.now() });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}));

/**
 * Broadcast event to all SSE clients in a group
 */
function broadcast(event: any) {
  const groupId = event.groupId;
  const id = nextEventId++;
  const payload = { ...event, id };

  eventBuffer.push({ id, groupId, payload });
  if (eventBuffer.length > MAX_BUFFER) eventBuffer.shift();

  const eventData = `id: ${id}\n` + `data: ${JSON.stringify(payload)}\n\n`;

  for (const [, client] of sseClients) {
    if (groupId && !client.groupIds.has(groupId)) continue;
    try {
      client.response.write(eventData);
    } catch (err) {
      logger.error("Failed to broadcast to client", { error: err });
    }
  }
}

function replayBuffered(client: SSEClient, groupId: string) {
  for (const item of eventBuffer) {
    if (item.id <= client.lastEventId) continue;
    if (item.groupId && item.groupId !== groupId) continue;
    const eventData = `id: ${item.id}\n` + `data: ${JSON.stringify(item.payload)}\n\n`;
    try {
      client.response.write(eventData);
    } catch (err) {
      logger.error("Failed to replay to client", { error: err });
    }
  }
  client.lastEventId = nextEventId - 1;
}

// Export broadcast for use by other routes
export { broadcast };

export default router;
