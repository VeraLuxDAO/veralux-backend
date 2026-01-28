/**
 * CAPTCHA Middleware
 * Verifies Google reCAPTCHA v3 tokens to prevent bot spam
 */

import axios from "axios";
import { createLogger } from "../logger.js";
import { ValidationError } from "../error-handler.js";

const logger = createLogger("captcha");

// Configuration
const RECAPTCHA_SECRET = process.env.RECAPTCHA_SECRET_KEY || "";
const RECAPTCHA_THRESHOLD = parseFloat(process.env.RECAPTCHA_THRESHOLD || "0.5");
const CAPTCHA_ENABLED = process.env.CAPTCHA_ENABLED !== "false"; // Default enabled

interface RecaptchaResponse {
  success: boolean;
  score?: number;
  action?: string;
  challenge_ts?: string;
  hostname?: string;
  "error-codes"?: string[];
}

/**
 * Verify reCAPTCHA v3 token
 * Checks if the request is from a human (score >= threshold)
 */
export async function verifyCaptcha(req: any, res: any, next: any) {
  // Skip verification in development if disabled
  if (!CAPTCHA_ENABLED) {
    logger.info("CAPTCHA verification skipped (disabled in config)");
    return next();
  }

  // Get token from header or body
  const token = req.headers["x-captcha-token"] || req.body?.captchaToken;

  if (!token) {
    logger.warn("CAPTCHA token missing", {
      ip: req.ip,
      path: req.path,
      method: req.method
    });
    throw new ValidationError("CAPTCHA verification required. Please refresh and try again.");
  }

  // Check if secret key is configured
  if (!RECAPTCHA_SECRET) {
    logger.error("RECAPTCHA_SECRET_KEY not configured");
    // In production, fail closed. In dev, could warn and continue
    if (process.env.NODE_ENV === "production") {
      throw new ValidationError("CAPTCHA verification temporarily unavailable");
    }
    logger.warn("CAPTCHA verification skipped (no secret key configured)");
    return next();
  }

  try {
    const response = await axios.post<RecaptchaResponse>(
      "https://www.google.com/recaptcha/api/siteverify",
      null,
      {
        params: {
          secret: RECAPTCHA_SECRET,
          response: token,
          remoteip: req.ip
        },
        timeout: 5000,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        }
      }
    );

    const { success, score = 0, action, "error-codes": errorCodes } = response.data;

    // Log verification result
    logger.info("CAPTCHA verification attempted", {
      success,
      score,
      action,
      ip: req.ip,
      path: req.path,
      errorCodes
    });

    if (!success) {
      logger.warn("CAPTCHA verification failed", {
        errorCodes,
        ip: req.ip,
        path: req.path
      });
      throw new ValidationError("CAPTCHA verification failed. Please try again.");
    }

    // reCAPTCHA v3 returns a score (0.0 - 1.0)
    // 0.0 = very likely a bot, 1.0 = very likely a human
    if (score < RECAPTCHA_THRESHOLD) {
      logger.warn("CAPTCHA score too low - possible bot", {
        score,
        threshold: RECAPTCHA_THRESHOLD,
        ip: req.ip,
        path: req.path,
        action
      });
      throw new ValidationError(
        "Suspicious activity detected. Please try again or contact support if you believe this is an error."
      );
    }

    // Store score in request for analytics
    req.captchaScore = score;
    req.captchaAction = action;

    next();
  } catch (error: any) {
    // If it's already a ValidationError, re-throw it
    if (error instanceof ValidationError) {
      throw error;
    }

    // Log unexpected errors
    logger.error("CAPTCHA verification error", {
      error: error.message,
      ip: req.ip,
      path: req.path,
      stack: error.stack
    });

    // Fail securely - don't let requests through on error
    throw new ValidationError(
      "CAPTCHA verification failed due to a technical error. Please try again."
    );
  }
}

/**
 * Create CAPTCHA middleware with custom threshold
 * Useful for high-risk endpoints that need stricter verification
 */
export function verifyCaptchaWithThreshold(threshold: number) {
  return async (req: any, res: any, next: any) => {
    const originalThreshold = process.env.RECAPTCHA_THRESHOLD;
    process.env.RECAPTCHA_THRESHOLD = threshold.toString();

    try {
      await verifyCaptcha(req, res, next);
    } catch (error) {
      // Restore original threshold before throwing
      process.env.RECAPTCHA_THRESHOLD = originalThreshold;
      throw error;
    }

    // Restore original threshold
    process.env.RECAPTCHA_THRESHOLD = originalThreshold;
  };
}

/**
 * Optional CAPTCHA verification
 * Only verifies if token is provided, otherwise continues
 * Useful for optional protection on public endpoints
 */
export async function optionalCaptcha(req: any, res: any, next: any) {
  const token = req.headers["x-captcha-token"] || req.body?.captchaToken;

  if (!token) {
    // No token provided, skip verification
    return next();
  }

  // Token provided, verify it
  try {
    await verifyCaptcha(req, res, next);
  } catch (error) {
    // Log but don't block
    logger.warn("Optional CAPTCHA verification failed", {
      error: error instanceof Error ? error.message : String(error),
      ip: req.ip
    });
    next();
  }
}
