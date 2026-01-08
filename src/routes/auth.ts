/**
 * Authentication Routes
 * Handles wallet login, token refresh, logout
 */

import { Router } from "express";
import { PrismaClient } from "@prisma/client";
import { createLogger } from "../logger.js";
import { loginBruteForceMiddleware, recordSuccessfulLogin } from "../rate-limiter.js";
import {
  authNonceSchema,
  authLoginSchema
} from "../validators.js";
import {
  requireAuth,
  refreshAccessToken,
  createNonce,
  authenticateWithWallet
} from "../auth.js";
import {
  AppError,
  NotFoundError,
  ConflictError,
  ValidationError,
  handlePrismaError,
  asyncHandler
} from "../error-handler.js";

const logger = createLogger("auth-routes");
const router = Router();

/**
 * Helper: Convert User model to UserProfile response
 */
function toUserProfile(user: any) {
  return {
    id: user.id,
    walletAddress: user.walletAddress,
    username: user.username,
    displayName: user.displayName,
    avatarPatchId: user.avatarPatchId,
    bio: user.bio,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? new Date().toISOString(),
    createdAt: user.createdAt?.toISOString() ?? new Date().toISOString()
  };
}

/**
 * GET /auth/nonce - Request a nonce to sign
 */
router.get("/nonce", asyncHandler(async (req: any, res: any, next: any) => {
  try {
    const parse = authNonceSchema.safeParse({ walletAddress: req.query.walletAddress });
    if (!parse.success) {
      throw new ValidationError(parse.error.issues[0].message);
    }

    const { walletAddress } = parse.data;
    const prisma = res.app.get("prisma") as PrismaClient;
    const { nonce, message, expiresAt } = await createNonce(prisma, walletAddress);

    res.json({ ok: true, walletAddress, nonce, message, expiresAt });
  } catch (err) {
    next(err);
  }
}));

/**
 * POST /auth - Wallet-based login with signature verification
 *
 * Flow: client requests /auth/nonce → signs message → POST /auth with walletAddress + signature
 */
router.post("/", loginBruteForceMiddleware, asyncHandler(async (req: any, res: any, next: any) => {
  try {
    const parsed = authLoginSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0].message);
    }

    const { walletAddress, signature } = parsed.data;
    const prisma = res.app.get("prisma") as PrismaClient;

    const result = await authenticateWithWallet(prisma, walletAddress, signature);
    if ("error" in result) {
      throw new ValidationError(result.error);
    }

    recordSuccessfulLogin(walletAddress.toLowerCase());

    const { user, tokens } = result;
    res.json({
      ok: true,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn,
      user: toUserProfile(user)
    });
  } catch (err) {
    next(err);
  }
}));

/**
 * POST /auth/refresh - Refresh access token
 *
 * @body refreshToken - The refresh token
 * @returns New access token and refresh token
 */
router.post("/refresh", async (req, res, next) => {
  try {
    const refreshToken = (req.body.refreshToken ?? "").toString();

    if (!refreshToken) {
      return res.status(400).json({
        ok: false,
        error: "refreshToken is required",
        code: "MISSING_REFRESH_TOKEN"
      });
    }

    const prisma = res.app.get("prisma") as PrismaClient;
    const result = await refreshAccessToken(prisma, refreshToken);

    if ("error" in result) {
      return res.status(401).json({
        ok: false,
        error: result.error,
        code: result.code
      });
    }

    res.json({
      ok: true,
      accessToken: result.tokens.accessToken,
      refreshToken: result.tokens.refreshToken,
      expiresIn: result.tokens.expiresIn
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /auth/logout - Logout user (invalidate refresh token)
 */
router.post("/logout", requireAuth, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const prisma = res.app.get("prisma") as PrismaClient;

    // Clear refresh token
    await prisma.user.update({
      where: { id: userId },
      data: {
        refreshToken: null,
        refreshTokenExpiresAt: null
      }
    });

    res.json({ ok: true, message: "Logged out successfully" });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /auth/profile - Get current user profile
 */
router.get("/profile", requireAuth, async (req, res, next) => {
  try {
    const userId = req.user!.id;
    const prisma = res.app.get("prisma") as PrismaClient;

    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      return res.status(404).json({ ok: false, error: "User not found" });
    }

    res.json({
      ok: true,
      user: toUserProfile(user)
    });
  } catch (err) {
    next(err);
  }
});

export default router;
