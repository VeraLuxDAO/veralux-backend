/**
 * Rate Limiting & Brute Force Protection
 * ======================================
 * Implements per-endpoint rate limiting and account lockout
 */

import type { Request, Response, NextFunction } from "express";
import { createLogger } from "./logger.js";

const logger = createLogger("rate-limiter");

// In-memory store (replace with Redis for production)
interface RateLimitRecord {
  count: number;
  resetTime: number;
}

interface BruteForceRecord {
  attempts: number;
  lockedUntil: number;
  lastAttemptTime: number;
}

const rateLimitStore = new Map<string, RateLimitRecord>();
const bruteForceStore = new Map<string, BruteForceRecord>();

// Configuration
const CONFIG = {
  // Default rate limits (requests per window)
  DEFAULT_LIMIT: 100,
  DEFAULT_WINDOW_MS: 60 * 1000, // 1 minute

  // Per-endpoint limits
  ENDPOINTS: {
    "/auth": { limit: 10, window: 60 * 1000 }, // legacy path fallback
    "/auth/login": { limit: 10, window: 60 * 1000 }, // signature login
    "/auth/nonce": { limit: 5, window: 60 * 1000 }, // nonce requests
    "/auth/me/avatar": { limit: 20, window: 60 * 60 * 1000 }, // 20 per hour
    "/chat": { limit: 50, window: 60 * 1000 }, // 50 messages per minute
    "/groups": { limit: 30, window: 60 * 1000 },
    "/circles": { limit: 20, window: 60 * 1000 },
  },

  // Brute force protection for login
  BRUTE_FORCE: {
    maxAttempts: 5,
    lockoutDuration: 15 * 60 * 1000, // 15 minutes
    window: 60 * 1000, // 1 minute - resets after 1 minute of no attempts
  },
};

/**
 * Generate rate limit key
 */
function getRateLimitKey(
  req: Request,
  identifier?: string
): string {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const userId = (req as any).user?.id;
  const key = identifier || userId || ip;

  const routePath = `${req.baseUrl || ""}${req.path}`.replace(/\/+$/, "");
  return `ratelimit:${routePath || "/"}:${key}`;
}

/**
 * Generate brute force key for login attempts
 */
function getBruteForceKey(identifier: string): string {
  return `bruteforce:login:${identifier}`;
}

/**
 * Clean up expired records
 */
function cleanupExpired(): void {
  const now = Date.now();

  // Clean rate limit store
  for (const [key, record] of rateLimitStore.entries()) {
    if (record.resetTime < now) {
      rateLimitStore.delete(key);
    }
  }

  // Clean brute force store
  for (const [key, record] of bruteForceStore.entries()) {
    if (record.lockedUntil < now && record.lastAttemptTime < now - 24 * 60 * 60 * 1000) {
      bruteForceStore.delete(key);
    }
  }
}

/**
 * Check rate limit for a request
 */
export function checkRateLimit(
  req: Request,
  res: Response,
  identifier?: string
): { allowed: boolean; remaining: number; resetIn: number } {
  const key = getRateLimitKey(req, identifier);
  const routePath = `${req.baseUrl || ""}${req.path}`.replace(/\/+$/, "") || "/";
  const config = CONFIG.ENDPOINTS[routePath as keyof typeof CONFIG.ENDPOINTS] || CONFIG.ENDPOINTS[req.path as keyof typeof CONFIG.ENDPOINTS] || {
    limit: CONFIG.DEFAULT_LIMIT,
    window: CONFIG.DEFAULT_WINDOW_MS,
  };

  const now = Date.now();
  let record = rateLimitStore.get(key);

  // Initialize or reset if window expired
  if (!record || record.resetTime < now) {
    record = {
      count: 0,
      resetTime: now + config.window,
    };
  }

  // Increment counter
  record.count++;
  rateLimitStore.set(key, record);

  const remaining = Math.max(0, config.limit - record.count);
  const resetIn = Math.max(0, record.resetTime - now);

  // Set rate limit headers
  res.set("X-RateLimit-Limit", String(config.limit));
  res.set("X-RateLimit-Remaining", String(remaining));
  res.set("X-RateLimit-Reset", String(record.resetTime));

  return {
    allowed: record.count <= config.limit,
    remaining,
    resetIn,
  };
}

/**
 * Check brute force protection for login attempts
 */
export function checkBruteForce(
  identifier: string
): { allowed: boolean; attempts: number; lockedUntil: number } {
  const key = getBruteForceKey(identifier);
  const now = Date.now();
  let record = bruteForceStore.get(key);

  // Initialize if doesn't exist
  if (!record) {
    record = {
      attempts: 0,
      lockedUntil: 0,
      lastAttemptTime: now,
    };
  }

  // Check if account is locked
  if (record.lockedUntil > now) {
    return {
      allowed: false,
      attempts: record.attempts,
      lockedUntil: record.lockedUntil,
    };
  }

  // Reset attempts if window has passed
  if (now - record.lastAttemptTime > CONFIG.BRUTE_FORCE.window) {
    record.attempts = 0;
  }

  // Increment attempts
  record.attempts++;
  record.lastAttemptTime = now;

  // Lock account if max attempts reached
  if (record.attempts > CONFIG.BRUTE_FORCE.maxAttempts) {
    record.lockedUntil = now + CONFIG.BRUTE_FORCE.lockoutDuration;
    logger.warn("Account brute force locked", { identifier, lockedUntil: record.lockedUntil });
  }

  bruteForceStore.set(key, record);

  return {
    allowed: record.attempts <= CONFIG.BRUTE_FORCE.maxAttempts,
    attempts: record.attempts,
    lockedUntil: record.lockedUntil,
  };
}

/**
 * Record successful login (resets brute force counter)
 */
export function recordSuccessfulLogin(identifier: string): void {
  const key = getBruteForceKey(identifier);
  bruteForceStore.delete(key);
  logger.debug("Successful login recorded", { identifier });
}

/**
 * Rate limiting middleware
 */
export function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Clean up expired records periodically
  if (Math.random() < 0.01) {
    cleanupExpired();
  }

  const limit = checkRateLimit(req, res);

  if (!limit.allowed) {
    res.status(429).json({
      ok: false,
      error: "Too many requests",
      retryAfter: Math.ceil(limit.resetIn / 1000),
      resetIn: limit.resetIn,
    });
    return;
  }

  next();
}

/**
 * Brute force protection middleware for login endpoints
 */
export function loginBruteForceMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const identifier = req.body?.walletAddress || req.ip || "unknown";

  const check = checkBruteForce(identifier);

  if (!check.allowed) {
    const waitMinutes = Math.ceil((check.lockedUntil - Date.now()) / 60000);
    res.status(429).json({
      ok: false,
      error: "Too many login attempts. Account temporarily locked.",
      lockedUntil: check.lockedUntil,
      waitMinutes,
      retryAfter: Math.ceil((check.lockedUntil - Date.now()) / 1000),
    });
    return;
  }

  next();
}

/**
 * Custom rate limit for specific endpoints
 */
export function createRateLimitMiddleware(
  limit: number,
  windowMs: number
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = getRateLimitKey(req);
    const now = Date.now();
    let record = rateLimitStore.get(key);

    if (!record || record.resetTime < now) {
      record = {
        count: 0,
        resetTime: now + windowMs,
      };
    }

    record.count++;
    rateLimitStore.set(key, record);

    const remaining = Math.max(0, limit - record.count);
    const resetIn = Math.max(0, record.resetTime - now);

    res.set("X-RateLimit-Limit", String(limit));
    res.set("X-RateLimit-Remaining", String(remaining));
    res.set("X-RateLimit-Reset", String(record.resetTime));

    if (record.count > limit) {
      res.status(429).json({
        ok: false,
        error: "Rate limit exceeded",
        retryAfter: Math.ceil(resetIn / 1000),
      });
      return;
    }

    next();
  };
}

/**
 * Get rate limit stats (for debugging)
 */
export function getRateLimitStats() {
  return {
    rateLimitRecords: rateLimitStore.size,
    bruteForceRecords: bruteForceStore.size,
  };
}
