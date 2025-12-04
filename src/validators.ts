import { z } from "zod";

const urlRegex = /(https?:\/\/[^\s]+)/gi;

// =============================================================================
// Utility Functions
// =============================================================================

export function parseAllowedHosts(): string[] {
  const raw = process.env.ALLOWED_LINK_HOSTS ?? "";
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Blocks any http/https links unless host is in ALLOWED_LINK_HOSTS.
 * If ALLOWED_LINK_HOSTS is empty => blocks all external links.
 */
export function assertNoExternalLinks(text?: string) {
  if (!text) return;
  const matches = text.match(urlRegex);
  if (!matches) return;

  const allowed = new Set(parseAllowedHosts());
  for (const m of matches) {
    try {
      const u = new URL(m);
      const host = u.hostname.toLowerCase();
      if (!allowed.size || !allowed.has(host)) {
        const err = new Error(
          "External links are not allowed. Only permitted hosts in ALLOWED_LINK_HOSTS may be used."
        );
        (err as any).status = 400;
        throw err;
      }
    } catch {
      const err = new Error("Invalid URL detected in text.");
      (err as any).status = 400;
      throw err;
    }
  }
}

// =============================================================================
// Authentication Schemas
// =============================================================================

/**
 * Sui wallet address validation
 * Format: 0x followed by 64 hex characters
 */
const suiAddressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{64}$/, "Invalid Sui wallet address format");

/**
 * Request nonce for wallet authentication
 */
export const authNonceSchema = z.object({
  walletAddress: suiAddressSchema
});

/**
 * Authenticate with wallet signature
 */
export const authLoginSchema = z.object({
  walletAddress: suiAddressSchema,
  signature: z
    .string()
    .min(10, "Signature is required")
    .max(500, "Signature too long")
});

/**
 * Refresh access token
 */
export const authRefreshSchema = z.object({
  refreshToken: z
    .string()
    .min(10, "Refresh token is required")
});

/**
 * Update user profile
 */
export const updateProfileSchema = z.object({
  username: z
    .string()
    .min(3, "Username must be at least 3 characters")
    .max(30, "Username must be at most 30 characters")
    .regex(/^[a-zA-Z0-9_]+$/, "Username can only contain letters, numbers, and underscores")
    .optional(),
  displayName: z
    .string()
    .min(1, "Display name must be at least 1 character")
    .max(50, "Display name must be at most 50 characters")
    .optional(),
  bio: z
    .string()
    .max(500, "Bio must be at most 500 characters")
    .optional()
});

// =============================================================================
// Flow Schemas
// =============================================================================

// =============================================================================
// Flow Schemas
// =============================================================================

export const postFlowTextSchema = z.object({
  text: z.string().min(1).max(2000)
});

export const postGlowSchema = z.object({
  flowPatchId: z.string().min(10)
});

export const postPromoteSchema = z.object({
  flowPatchId: z.string().min(10)
});

export const postGroupSchema = z.object({
  type: z.enum(["room", "circle"]),
  name: z.string().min(1).max(80)
});

export const postJoinSchema = z.object({
  groupId: z.string().min(1)
});

export const postChatSchema = z.object({
  text: z.string().min(1).max(2000),
  groupId: z.string().optional()
});
