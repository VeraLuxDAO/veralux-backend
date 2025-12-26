/**
 * Authentication Routes
 * Handles wallet login, token refresh, logout
 */

import { Router } from "express";
import { PrismaClient } from "@prisma/client";
import { createLogger } from "../logger.js";
import {
  generateTokens,
  hashRefreshToken,
  requireAuth,
  verifyRefreshToken,
  refreshAccessToken,
  isValidSuiAddress
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
 * POST /auth - Simple wallet-based login (Temporary - No signature verification)
 *
 * Creates or logs in user by wallet address only.
 * TODO: Implement signature verification in the future.
 *
 * @body walletAddress - The Sui wallet address
 * @returns Access token, refresh token, and user profile
 */
router.post("/", async (req, res, next) => {
  try {
    const walletAddress = (req.body.walletAddress ?? "").toString();

    if (!walletAddress) {
      return res.status(400).json({
        ok: false,
        error: "walletAddress is required",
        code: "MISSING_WALLET_ADDRESS"
      });
    }

    if (!isValidSuiAddress(walletAddress)) {
      return res.status(400).json({
        ok: false,
        error: "Invalid Sui wallet address format",
        code: "INVALID_WALLET_ADDRESS"
      });
    }

    const normalizedAddress = walletAddress.toLowerCase();
    const prisma = res.app.get("prisma") as PrismaClient;

    // Find or create user
    let user = await prisma.user.findUnique({
      where: { walletAddress: normalizedAddress }
    });

    if (!user) {
      // Create new user
      user = await prisma.user.create({
        data: {
          walletAddress: normalizedAddress,
          lastLoginAt: new Date()
        }
      });
      logger.info("New user created", { userId: user.id, walletAddress: normalizedAddress });
    } else {
      // Update last login
      user = await prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() }
      });
      logger.info("User logged in", { userId: user.id, walletAddress: normalizedAddress });
    }

    // Generate tokens
    const tokens = generateTokens(user.id, normalizedAddress);
    const hashedRefreshToken = hashRefreshToken(tokens.refreshToken);

    // Store refresh token
    const refreshTokenExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    await prisma.user.update({
      where: { id: user.id },
      data: {
        refreshToken: hashedRefreshToken,
        refreshTokenExpiresAt
      }
    });

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
});

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
