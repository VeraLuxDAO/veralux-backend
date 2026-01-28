/**
 * Group moderation endpoints
 */

import { Express, Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { requireAuth } from "../auth.js";
import { createLogger } from "../logger.js";
import { logAudit, AuditAction } from "../audit.js";

const logger = createLogger("moderation");

/**
 * Setup moderation routes
 */
export function setupModerationRoutes(app: Express, prisma: PrismaClient, prefix = ""): void {
  /**
   * POST /groups/:groupId/members/:memberId/kick
   * Kick a member from the group (admin+ only)
   */
  app.post(`${prefix}/groups/:groupId/members/:memberId/kick`, requireAuth, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const { groupId, memberId } = req.params;

      // Check if actor is admin/creator
      const actorMembership = await (prisma as any).membership.findFirst({
        where: { groupId, memberId: user.id }
      });

      if (!actorMembership || !["CREATOR", "ADMIN", "MODERATOR"].includes(actorMembership.role)) {
        return res.status(403).json({ error: "Insufficient permissions" });
      }

      // Cannot kick creator
      const targetMembership = await (prisma as any).membership.findFirst({
        where: { groupId, memberId }
      });

      if (!targetMembership) {
        return res.status(404).json({ error: "Member not found" });
      }

      if (targetMembership.role === "CREATOR") {
        return res.status(403).json({ error: "Cannot kick creator" });
      }

      // Remove membership
      await (prisma as any).membership.delete({
        where: { id: targetMembership.id }
      });

      // Log audit
      await logAudit(prisma, AuditAction.MEMBER_KICK, user.id, memberId, groupId, {
        reason: req.body.reason || "No reason provided"
      });

      logger.info("Member kicked", { groupId, memberId, actorId: user.id });

      return res.json({ success: true, message: "Member kicked" });
    } catch (err) {
      logger.error("Failed to kick member", { error: err });
      return res.status(500).json({ error: "Failed to kick member" });
    }
  });

  /**
   * POST /groups/:groupId/members/:memberId/ban
   * Ban a member from the group (creator only)
   */
  app.post(`${prefix}/groups/:groupId/members/:memberId/ban`, requireAuth, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const { groupId, memberId } = req.params;

      // Check if actor is creator
      const actorMembership = await (prisma as any).membership.findFirst({
        where: { groupId, memberId: user.id }
      });

      if (!actorMembership || actorMembership.role !== "CREATOR") {
        return res.status(403).json({ error: "Only creator can ban members" });
      }

      // Cannot ban creator
      if (memberId === user.id) {
        return res.status(403).json({ error: "Cannot ban yourself" });
      }

      const targetMembership = await (prisma as any).membership.findFirst({
        where: { groupId, memberId }
      });

      if (!targetMembership) {
        return res.status(404).json({ error: "Member not found" });
      }

      // Create ban record
      const ban = await (prisma as any).memberBan.create({
        data: {
          groupId,
          bannedUserId: memberId,
          bannedBy: user.id,
          reason: req.body.reason || "No reason provided",
          createdAt: new Date()
        }
      });

      // Remove membership if exists
      if (targetMembership) {
        await (prisma as any).membership.delete({
          where: { id: targetMembership.id }
        });
      }

      // Log audit
      await logAudit(prisma, AuditAction.MEMBER_BAN, user.id, memberId, groupId, {
        reason: req.body.reason || "No reason provided"
      });

      logger.info("Member banned", { groupId, memberId, actorId: user.id });

      return res.json({ success: true, message: "Member banned", ban });
    } catch (err) {
      logger.error("Failed to ban member", { error: err });
      return res.status(500).json({ error: "Failed to ban member" });
    }
  });

  /**
   * DELETE /groups/:groupId/members/:memberId/ban
   * Unban a member (creator only)
   */
  app.delete(`${prefix}/groups/:groupId/members/:memberId/ban`, requireAuth, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const { groupId, memberId } = req.params;

      // Check if actor is creator
      const actorMembership = await (prisma as any).membership.findFirst({
        where: { groupId, memberId: user.id }
      });

      if (!actorMembership || actorMembership.role !== "CREATOR") {
        return res.status(403).json({ error: "Only creator can unban members" });
      }

      const ban = await (prisma as any).memberBan.findFirst({
        where: { groupId, bannedUserId: memberId }
      });

      if (!ban) {
        return res.status(404).json({ error: "Ban not found" });
      }

      await (prisma as any).memberBan.delete({
        where: { id: ban.id }
      });

      logger.info("Member unbanned", { groupId, memberId, actorId: user.id });

      return res.json({ success: true, message: "Member unbanned" });
    } catch (err) {
      logger.error("Failed to unban member", { error: err });
      return res.status(500).json({ error: "Failed to unban member" });
    }
  });

  /**
   * GET /groups/:groupId/bans
   * List banned members (creator only)
   */
  app.get(`${prefix}/groups/:groupId/bans`, requireAuth, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const { groupId } = req.params;

      // Check if actor is creator
      const actorMembership = await (prisma as any).membership.findFirst({
        where: { groupId, memberId: user.id }
      });

      if (!actorMembership || actorMembership.role !== "CREATOR") {
        return res.status(403).json({ error: "Only creator can view bans" });
      }

      const bans = await (prisma as any).memberBan.findMany({
        where: { groupId },
        select: {
          id: true,
          bannedUserId: true,
          reason: true,
          createdAt: true
        }
      });

      return res.json({ bans });
    } catch (err) {
      logger.error("Failed to fetch bans", { error: err });
      return res.status(500).json({ error: "Failed to fetch bans" });
    }
  });

  /**
   * DELETE /chat/:messageId/moderate
   * Delete a message (moderator+ only)
   */
  app.delete(`${prefix}/chat/:messageId/moderate`, requireAuth, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const { messageId } = req.params;

      const message = await (prisma as any).chat.findUnique({
        where: { id: messageId }
      });

      if (!message) {
        return res.status(404).json({ error: "Message not found" });
      }

      // Check if actor is moderator+
      const actorMembership = await (prisma as any).membership.findFirst({
        where: { groupId: message.groupId, memberId: user.id }
      });

      if (!actorMembership || !["CREATOR", "ADMIN", "MODERATOR"].includes(actorMembership.role)) {
        return res.status(403).json({ error: "Insufficient permissions" });
      }

      // Delete message and related records
      await (prisma as any).messageRead.deleteMany({ where: { messageId } });
      await (prisma as any).messageReaction.deleteMany({ where: { messageId } });

      await (prisma as any).chat.delete({
        where: { id: messageId }
      });

      // Log audit
      await logAudit(prisma, AuditAction.MESSAGE_DELETE, user.id, messageId, message.groupId, {
        reason: req.body.reason || "Moderation action",
        moderator: true
      });

      logger.info("Message moderated", { messageId, moderatorId: user.id, groupId: message.groupId });

      return res.json({ success: true, message: "Message deleted" });
    } catch (err) {
      logger.error("Failed to moderate message", { error: err });
      return res.status(500).json({ error: "Failed to delete message" });
    }
  });
}
