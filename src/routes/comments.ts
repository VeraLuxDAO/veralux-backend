/**
 * Comments Routes
 * Handles comments on Flow posts with threading support
 */

import { Router } from "express";
import { z } from "zod";
import { PrismaClient } from "@prisma/client";
import { createLogger } from "../logger.js";
import { requireAuth } from "../auth.js";
import { sanitizeInput } from "../sanitizer.js";
import { paginationSchema } from "../validators.js";
import { verifyCaptcha } from "../middleware/captcha.js";
import {
  AppError,
  NotFoundError,
  ValidationError,
  AuthorizationError,
  handlePrismaError,
  asyncHandler
} from "../error-handler.js";

const logger = createLogger("comments-routes");
const router = Router();

// Validation schemas
const createCommentSchema = z.object({
  content: z.string().min(1).max(2000),
  parentId: z.string().optional()
});

const updateCommentSchema = z.object({
  content: z.string().min(1).max(2000)
});

/**
 * Helper: Format comment for response
 */
function formatComment(comment: any) {
  return {
    id: comment.id,
    content: comment.content,
    flowId: comment.flowId,
    parentId: comment.parentId,
    author: comment.author ? {
      id: comment.author.id,
      walletAddress: comment.author.walletAddress,
      username: comment.author.username,
      displayName: comment.author.displayName,
      avatarPatchId: comment.author.avatarPatchId
    } : null,
    createdAt: comment.createdAt?.toISOString(),
    updatedAt: comment.updatedAt?.toISOString(),
    isDeleted: !!comment.deletedAt,
    replyCount: comment._count?.replies || 0
  };
}

/**
 * POST /flows/:flowId/comments - Create a new comment on a flow
 * Supports both top-level comments and threaded replies
 */
router.post("/:flowId/comments", requireAuth, verifyCaptcha, asyncHandler(async (req: any, res: any, next: any) => {
  try {
    const userId = req.user!.id;
    const { flowId } = req.params;
    const validationResult = createCommentSchema.safeParse(req.body);

    if (!validationResult.success) {
      throw new ValidationError(validationResult.error.issues[0].message);
    }

    const { content, parentId } = validationResult.data;
    const prisma = res.app.get("prisma") as PrismaClient;

    // Verify flow exists
    const flow = await prisma.flow.findUnique({
      where: { id: flowId }
    });

    if (!flow) {
      throw new NotFoundError("Flow not found");
    }

    // If replying to a comment, verify it exists and belongs to the same flow
    if (parentId) {
      const parentComment = await prisma.comment.findUnique({
        where: { id: parentId }
      });

      if (!parentComment) {
        throw new NotFoundError("Parent comment not found");
      }

      if (parentComment.flowId !== flowId) {
        throw new ValidationError("Parent comment does not belong to this flow");
      }

      if (parentComment.deletedAt) {
        throw new ValidationError("Cannot reply to a deleted comment");
      }
    }

    // Create comment
    const comment = await prisma.comment.create({
      data: {
        content: sanitizeInput(content),
        authorId: userId,
        flowId,
        parentId: parentId || null
      },
      include: {
        author: {
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

    logger.info("Comment created", { 
      commentId: comment.id, 
      flowId, 
      userId, 
      isReply: !!parentId 
    });

    res.status(201).json({
      ok: true,
      comment: formatComment(comment)
    });
  } catch (err) {
    next(err);
  }
}));

/**
 * GET /flows/:flowId/comments - Get all comments for a flow
 * Supports pagination and returns top-level comments with reply counts
 */
router.get("/:flowId/comments", asyncHandler(async (req: any, res: any, next: any) => {
  try {
    const { flowId } = req.params;
    const paginationResult = paginationSchema.safeParse({
      limit: req.query.limit,
      offset: req.query.offset
    });

    if (!paginationResult.success) {
      throw new ValidationError(paginationResult.error.issues[0].message);
    }

    const { limit = 20, offset = 0 } = paginationResult.data;
    const finalLimit = Math.min(limit, 100);
    const prisma = res.app.get("prisma") as PrismaClient;

    // Verify flow exists
    const flow = await prisma.flow.findUnique({
      where: { id: flowId }
    });

    if (!flow) {
      throw new NotFoundError("Flow not found");
    }

    // Get top-level comments (no parent) that aren't deleted
    const comments = await prisma.comment.findMany({
      where: {
        flowId,
        parentId: null,
        deletedAt: null
      },
      include: {
        author: {
          select: {
            id: true,
            walletAddress: true,
            username: true,
            displayName: true,
            avatarPatchId: true
          }
        },
        _count: {
          select: {
            replies: {
              where: { deletedAt: null }
            }
          }
        }
      },
      orderBy: { createdAt: "desc" },
      skip: offset,
      take: finalLimit
    });

    // Get total count
    const total = await prisma.comment.count({
      where: {
        flowId,
        parentId: null,
        deletedAt: null
      }
    });

    res.json({
      ok: true,
      flowId,
      comments: comments.map(formatComment),
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
 * GET /comments/:commentId/replies - Get all replies to a comment
 * Returns nested replies with pagination
 */
router.get("/:commentId/replies", asyncHandler(async (req: any, res: any, next: any) => {
  try {
    const { commentId } = req.params;
    const paginationResult = paginationSchema.safeParse({
      limit: req.query.limit,
      offset: req.query.offset
    });

    if (!paginationResult.success) {
      throw new ValidationError(paginationResult.error.issues[0].message);
    }

    const { limit = 20, offset = 0 } = paginationResult.data;
    const finalLimit = Math.min(limit, 100);
    const prisma = res.app.get("prisma") as PrismaClient;

    // Verify parent comment exists
    const parentComment = await prisma.comment.findUnique({
      where: { id: commentId }
    });

    if (!parentComment) {
      throw new NotFoundError("Comment not found");
    }

    // Get replies
    const replies = await prisma.comment.findMany({
      where: {
        parentId: commentId,
        deletedAt: null
      },
      include: {
        author: {
          select: {
            id: true,
            walletAddress: true,
            username: true,
            displayName: true,
            avatarPatchId: true
          }
        },
        _count: {
          select: {
            replies: {
              where: { deletedAt: null }
            }
          }
        }
      },
      orderBy: { createdAt: "asc" },
      skip: offset,
      take: finalLimit
    });

    // Get total count
    const total = await prisma.comment.count({
      where: {
        parentId: commentId,
        deletedAt: null
      }
    });

    res.json({
      ok: true,
      commentId,
      replies: replies.map(formatComment),
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
 * PUT /comments/:commentId - Update a comment
 * Only the comment author can update their comment
 */
router.put("/:commentId", requireAuth, asyncHandler(async (req: any, res: any, next: any) => {
  try {
    const userId = req.user!.id;
    const { commentId } = req.params;
    const validationResult = updateCommentSchema.safeParse(req.body);

    if (!validationResult.success) {
      throw new ValidationError(validationResult.error.issues[0].message);
    }

    const { content } = validationResult.data;
    const prisma = res.app.get("prisma") as PrismaClient;

    // Get comment
    const comment = await prisma.comment.findUnique({
      where: { id: commentId }
    });

    if (!comment) {
      throw new NotFoundError("Comment not found");
    }

    if (comment.deletedAt) {
      throw new ValidationError("Cannot edit a deleted comment");
    }

    // Check ownership
    if (comment.authorId !== userId) {
      throw new AuthorizationError("You can only edit your own comments");
    }

    // Update comment
    const updatedComment = await prisma.comment.update({
      where: { id: commentId },
      data: {
        content: sanitizeInput(content)
      },
      include: {
        author: {
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

    logger.info("Comment updated", { commentId, userId });

    res.json({
      ok: true,
      comment: formatComment(updatedComment)
    });
  } catch (err) {
    next(err);
  }
}));

/**
 * DELETE /comments/:commentId - Delete a comment (soft delete)
 * Only the comment author can delete their comment
 */
router.delete("/:commentId", requireAuth, asyncHandler(async (req: any, res: any, next: any) => {
  try {
    const userId = req.user!.id;
    const { commentId } = req.params;
    const prisma = res.app.get("prisma") as PrismaClient;

    // Get comment
    const comment = await prisma.comment.findUnique({
      where: { id: commentId }
    });

    if (!comment) {
      throw new NotFoundError("Comment not found");
    }

    if (comment.deletedAt) {
      throw new ValidationError("Comment is already deleted");
    }

    // Check ownership
    if (comment.authorId !== userId) {
      throw new AuthorizationError("You can only delete your own comments");
    }

    // Soft delete
    await prisma.comment.update({
      where: { id: commentId },
      data: {
        deletedAt: new Date()
      }
    });

    logger.info("Comment deleted", { commentId, userId });

    res.json({
      ok: true,
      message: "Comment deleted successfully"
    });
  } catch (err) {
    next(err);
  }
}));

/**
 * GET /flows/:flowId/comments/count - Get comment count for a flow
 * Returns total count including replies
 */
router.get("/:flowId/comments/count", asyncHandler(async (req: any, res: any, next: any) => {
  try {
    const { flowId } = req.params;
    const prisma = res.app.get("prisma") as PrismaClient;

    // Verify flow exists
    const flow = await prisma.flow.findUnique({
      where: { id: flowId }
    });

    if (!flow) {
      throw new NotFoundError("Flow not found");
    }

    // Get total comment count (excluding deleted)
    const count = await prisma.comment.count({
      where: {
        flowId,
        deletedAt: null
      }
    });

    res.json({
      ok: true,
      flowId,
      count
    });
  } catch (err) {
    next(err);
  }
}));

export default router;
