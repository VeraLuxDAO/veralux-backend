/**
 * Audit logging for sensitive operations
 */

import { PrismaClient } from "@prisma/client";
import { createLogger } from "./logger.js";

const logger = createLogger("audit");

export enum AuditAction {
  MESSAGE_DELETE = "MESSAGE_DELETE",
  MESSAGE_EDIT = "MESSAGE_EDIT",
  MEMBER_KICK = "MEMBER_KICK",
  MEMBER_BAN = "MEMBER_BAN",
  MEMBER_ROLE_CHANGE = "MEMBER_ROLE_CHANGE",
  USER_BLOCK = "USER_BLOCK",
  USER_UNBLOCK = "USER_UNBLOCK",
  GROUP_DELETE = "GROUP_DELETE",
  GROUP_UPDATE = "GROUP_UPDATE"
}

export async function logAudit(
  prisma: PrismaClient,
  action: AuditAction,
  actorId: string,
  targetId: string,
  groupId?: string,
  details?: any
): Promise<void> {
  try {
    await (prisma as any).auditLog.create({
      data: {
        action,
        actorId,
        targetId,
        groupId,
        details: details ? JSON.stringify(details) : null,
        timestamp: new Date()
      }
    });

    logger.info("Audit log", { action, actorId, targetId, groupId });
  } catch (err) {
    logger.error("Failed to write audit log", { error: err, action });
  }
}

export async function getAuditLogs(
  prisma: PrismaClient,
  groupId?: string,
  limit = 50,
  offset = 0
): Promise<any[]> {
  try {
    return await (prisma as any).auditLog.findMany({
      where: groupId ? { groupId } : {},
      take: limit,
      skip: offset,
      orderBy: { timestamp: "desc" }
    });
  } catch (err) {
    logger.error("Failed to fetch audit logs", { error: err });
    return [];
  }
}
