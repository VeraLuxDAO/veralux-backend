/**
 * Message reactions system
 */

import { Express, Request, Response } from "express";
import { z } from "zod";
import { PrismaClient } from "@prisma/client";
import { requireAuth } from "../auth.js";
import { createLogger } from "../logger.js";
import { logAudit, AuditAction } from "../audit.js";

const logger = createLogger("reactions");

// Allowed emojis for reactions
const ALLOWED_EMOJIS = [
  "👍", "❤️", "😂", "😮", "😢", "🔥", "👎", "🎉",
  "😍", "🤔", "😴", "🤗", "👏", "🙏", "💯", "✨"
];

const reactionSchema = z.object({
  emoji: z.string().refine(e => ALLOWED_EMOJIS.includes(e), "Invalid emoji"),
  messageId: z.string().min(1)
});

/**
 * Setup reactions routes
 */
export function setupReactionsRoutes(app: Express, prisma: PrismaClient, prefix = ""): void {
  /**
   * POST /chat/:messageId/reaction
   * Add a reaction to a message
   */
  app.post(`${prefix}/chat/:messageId/reaction`, requireAuth, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const { messageId } = req.params;
      const { emoji } = reactionSchema.parse(req.body);

      // Check if message exists
      const message = await (prisma as any).chat.findUnique({ where: { id: messageId } });
      if (!message) {
        return res.status(404).json({ error: "Message not found" });
      }

      // Check if reaction already exists
      const existingReaction = await (prisma as any).messageReaction.findUnique({
        where: {
          userId_messageId_emoji: {
            userId: user.id,
            messageId,
            emoji
          }
        }
      });

      if (existingReaction) {
        // Remove reaction if already exists (toggle)
        await (prisma as any).messageReaction.delete({
          where: {
            userId_messageId_emoji: {
              userId: user.id,
              messageId,
              emoji
            }
          }
        });

        logger.info("Reaction removed", { userId: user.id, messageId, emoji });
        return res.json({ action: "removed", emoji });
      }

      // Add new reaction
      const reaction = await (prisma as any).messageReaction.create({
        data: {
          userId: user.id,
          messageId,
          emoji,
          createdAt: new Date()
        }
      });

      logger.info("Reaction added", { userId: user.id, messageId, emoji });

      // Log audit (optional for reactions)
      await logAudit(prisma, AuditAction.MESSAGE_EDIT as any, user.id, messageId, message.groupId, {
        action: "reaction_added",
        emoji
      });

      return res.json({ action: "added", ...reaction });
    } catch (err) {
      logger.error("Failed to add reaction", { error: err });
      return res.status(400).json({ error: "Invalid request" });
    }
  });

  /**
   * GET /chat/:messageId/reactions
   * Get all reactions for a message
   */
  app.get(`${prefix}/chat/:messageId/reactions`, async (req: Request, res: Response) => {
    try {
      const { messageId } = req.params;

      const reactions = await (prisma as any).messageReaction.groupBy({
        by: ["emoji"],
        where: { messageId },
        _count: { emoji: true }
      });

      // Get current user's reactions
      const user = (req as any).user;
      const userReactions = user
        ? await (prisma as any).messageReaction.findMany({
            where: { messageId, userId: user.id },
            select: { emoji: true }
          })
        : [];

      const reactionsWithCount = reactions.map((r: any) => ({
        emoji: r.emoji,
        count: r._count.emoji,
        reacted: userReactions.some((ur: any) => ur.emoji === r.emoji)
      }));

      return res.json({ reactions: reactionsWithCount });
    } catch (err) {
      logger.error("Failed to fetch reactions", { error: err });
      return res.status(500).json({ error: "Failed to fetch reactions" });
    }
  });

  /**
   * DELETE /chat/:messageId/reaction/:emoji
   * Remove a reaction from a message
   */
  app.delete(`${prefix}/chat/:messageId/reaction/:emoji`, requireAuth, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const { messageId, emoji } = req.params;

      // Validate emoji
      if (!ALLOWED_EMOJIS.includes(emoji)) {
        return res.status(400).json({ error: "Invalid emoji" });
      }

      const message = await (prisma as any).chat.findUnique({ where: { id: messageId } });
      if (!message) {
        return res.status(404).json({ error: "Message not found" });
      }

      const reaction = await (prisma as any).messageReaction.findUnique({
        where: {
          userId_messageId_emoji: {
            userId: user.id,
            messageId,
            emoji
          }
        }
      });

      if (!reaction) {
        return res.status(404).json({ error: "Reaction not found" });
      }

      await (prisma as any).messageReaction.delete({
        where: {
          userId_messageId_emoji: {
            userId: user.id,
            messageId,
            emoji
          }
        }
      });

      logger.info("Reaction deleted", { userId: user.id, messageId, emoji });

      return res.json({ success: true });
    } catch (err) {
      logger.error("Failed to delete reaction", { error: err });
      return res.status(500).json({ error: "Failed to delete reaction" });
    }
  });
}

/**
 * Get available emojis for client
 */
export function getAvailableEmojis() {
  return ALLOWED_EMOJIS;
}
