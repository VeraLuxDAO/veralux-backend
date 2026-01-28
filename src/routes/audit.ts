/**
 * Audit logging endpoints
 */

import { Express, Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { requireAuth } from "../auth.js";
import { createLogger } from "../logger.js";
import { getAuditLogs } from "../audit.js";

const logger = createLogger("audit-routes");

/**
 * Setup audit routes
 */
export function setupAuditRoutes(app: Express, prisma: PrismaClient, prefix = ""): void {
  /**
   * GET /audit/logs
   * Get audit logs for a group (admin+ only)
   */
  app.get(`${prefix}/audit/logs`, requireAuth, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const { groupId, limit = "50", offset = "0" } = req.query;

      if (!groupId) {
        return res.status(400).json({ error: "groupId is required" });
      }

      // Check if user is admin of the group
      const membership = await (prisma as any).membership.findFirst({
        where: {
          groupId: String(groupId),
          memberId: user.id,
          role: { in: ["CREATOR", "ADMIN"] }
        }
      });

      if (!membership) {
        return res.status(403).json({ error: "Insufficient permissions" });
      }

      const parsedLimit = Math.min(Number(limit) || 50, 100);
      const parsedOffset = Number(offset) || 0;

      const logs = await getAuditLogs(
        prisma,
        String(groupId),
        parsedLimit,
        parsedOffset
      );

      return res.json({ logs });
    } catch (err) {
      logger.error("Failed to fetch audit logs", { error: err });
      return res.status(500).json({ error: "Failed to fetch audit logs" });
    }
  });

  /**
   * GET /audit/user/:userId
   * Get audit logs for actions performed by a user (admin+ only)
   */
  app.get(`${prefix}/audit/user/:userId`, requireAuth, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const { userId } = req.params;
      const { groupId, limit = "50", offset = "0" } = req.query;

      if (!groupId) {
        return res.status(400).json({ error: "groupId is required" });
      }

      // Check if user is admin of the group
      const membership = await (prisma as any).membership.findFirst({
        where: {
          groupId: String(groupId),
          memberId: user.id,
          role: { in: ["CREATOR", "ADMIN"] }
        }
      });

      if (!membership) {
        return res.status(403).json({ error: "Insufficient permissions" });
      }

      const parsedLimit = Math.min(Number(limit) || 50, 100);
      const parsedOffset = Number(offset) || 0;

      const logs = await (prisma as any).auditLog.findMany({
        where: {
          actorId: userId,
          groupId: String(groupId)
        },
        take: parsedLimit,
        skip: parsedOffset,
        orderBy: { timestamp: "desc" }
      });

      return res.json({ logs });
    } catch (err) {
      logger.error("Failed to fetch user audit logs", { error: err });
      return res.status(500).json({ error: "Failed to fetch user audit logs" });
    }
  });
}
