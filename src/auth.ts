/**
 * Authentication Module
 * =====================
 * Implements wallet-based authentication for Sui blockchain users.
 * 
 * Flow:
 * 1. Client requests nonce via GET /auth/nonce?walletAddress=0x...
 * 2. Client signs the nonce message with their wallet
 * 3. Client submits signature to POST /auth with walletAddress + signature
 * 4. Server verifies signature, creates/updates user, returns JWT tokens
 * 5. Client uses access token for authenticated requests
 * 6. Client uses refresh token to get new access tokens
 * 
 * Security features:
 * - Nonce expires after 5 minutes
 * - Access tokens expire in 15 minutes
 * - Refresh tokens expire in 7 days
 * - Refresh tokens are hashed before storage
 * - Rate limiting recommended at nginx/cloudflare level
 */

import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { Ed25519PublicKey } from "@mysten/sui/keypairs/ed25519";
import { fromBase64, toBase64 } from "@mysten/sui/utils";
import type { Request, Response, NextFunction } from "express";
import { PrismaClient, User } from "@prisma/client";
import { createLogger } from "./logger.js";

const logger = createLogger("auth");

// =============================================================================
// Configuration
// =============================================================================

const JWT_SECRET = process.env.JWT_SECRET || (() => {
  logger.warn("JWT_SECRET not set, using random secret (tokens will invalidate on restart)");
  return crypto.randomBytes(32).toString("hex");
})();

const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || (() => {
  logger.warn("JWT_REFRESH_SECRET not set, using random secret");
  return crypto.randomBytes(32).toString("hex");
})();

// Token expiration times
const ACCESS_TOKEN_EXPIRES_IN = process.env.ACCESS_TOKEN_EXPIRES_IN || "15m";
const REFRESH_TOKEN_EXPIRES_IN = process.env.REFRESH_TOKEN_EXPIRES_IN || "7d";
const NONCE_EXPIRES_IN_MS = 5 * 60 * 1000; // 5 minutes

// Parse duration string to milliseconds
function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)(s|m|h|d)$/);
  if (!match) return 15 * 60 * 1000; // default 15 minutes
  
  const value = parseInt(match[1], 10);
  const unit = match[2];
  
  switch (unit) {
    case "s": return value * 1000;
    case "m": return value * 60 * 1000;
    case "h": return value * 60 * 60 * 1000;
    case "d": return value * 24 * 60 * 60 * 1000;
    default: return 15 * 60 * 1000;
  }
}

// =============================================================================
// Types
// =============================================================================

export interface JwtPayload {
  sub: string;           // User ID
  wallet: string;        // Wallet address
  iat: number;           // Issued at
  exp: number;           // Expiration
  type: "access" | "refresh";
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;     // Access token expiry in seconds
}

// Note: AuthenticatedRequest type is defined globally in types.ts
// via Express.Request augmentation

// =============================================================================
// Nonce Management
// =============================================================================

/**
 * Generate a cryptographically secure nonce
 */
export function generateNonce(): string {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Create the message that users must sign
 * This message is displayed in the wallet UI
 */
export function createSignMessage(nonce: string, walletAddress: string): string {
  return `Sign this message to authenticate with YNX\n\nWallet: ${walletAddress}\nNonce: ${nonce}\nTimestamp: ${new Date().toISOString()}`;
}

// =============================================================================
// Signature Verification
// =============================================================================

/**
 * Verify a Sui wallet signature
 * 
 * The signature should be the result of signPersonalMessage() from @mysten/wallet-standard
 * Format: base64 encoded signature bytes
 */
export async function verifySuiSignature(
  walletAddress: string,
  message: string,
  signature: string
): Promise<boolean> {
  try {
    logger.debug("Verifying signature", { walletAddress, messageLength: message.length, signatureLength: signature.length });
    
    // Decode the signature from base64
    const signatureBytes = fromBase64(signature);
    logger.debug("Signature decoded", { bytesLength: signatureBytes.length });
    
    // Sui signatures are: [scheme_flag (1 byte)] + [signature (64 bytes)] + [public_key (32 bytes)]
    // For Ed25519: scheme_flag = 0x00
    if (signatureBytes.length !== 97) {
      logger.warn("Invalid signature length", { length: signatureBytes.length, expected: 97 });
      return false;
    }
    
    const schemeFlag = signatureBytes[0];
    logger.debug("Scheme flag", { schemeFlag });
    if (schemeFlag !== 0x00) {
      logger.warn("Unsupported signature scheme", { scheme: schemeFlag });
      return false;
    }
    
    // Extract signature and public key
    const sig = signatureBytes.slice(1, 65);
    const publicKeyBytes = signatureBytes.slice(65, 97);
    logger.debug("Extracted components", { sigLength: sig.length, pubKeyLength: publicKeyBytes.length });
    
    // Create public key object and derive address
    const publicKey = new Ed25519PublicKey(publicKeyBytes);
    const derivedAddress = publicKey.toSuiAddress();
    logger.debug("Derived address", { derived: derivedAddress, expected: walletAddress });
    
    // Verify the address matches
    if (derivedAddress.toLowerCase() !== walletAddress.toLowerCase()) {
      logger.warn("Address mismatch", { derived: derivedAddress, expected: walletAddress });
      return false;
    }
    
    // Sui personal message format: intent bytes + message
    // Intent for personal message signing: [3, 0, 0]
    const intentBytes = new Uint8Array([3, 0, 0]);
    const messageBytes = new TextEncoder().encode(message);
    const fullMessage = new Uint8Array(intentBytes.length + messageBytes.length);
    fullMessage.set(intentBytes);
    fullMessage.set(messageBytes, intentBytes.length);
    logger.debug("Full message created", { length: fullMessage.length });
    
    // Hash the full message with SHA-256 (Blake2b not available in Node.js crypto)
    const hash = crypto.createHash("sha256").update(fullMessage).digest();
    logger.debug("Message hashed", { hashLength: hash.length });
    
    // Verify the signature using Node.js crypto
    try {
      const keyObject = crypto.createPublicKey({
        key: Buffer.concat([
          // Ed25519 public key DER prefix
          Buffer.from("302a300506032b6570032100", "hex"),
          Buffer.from(publicKeyBytes)
        ]),
        format: "der",
        type: "spki"
      });
      
      const isValid = crypto.verify(
        null,
        Buffer.from(hash),
        keyObject,
        Buffer.from(sig)
      );
      
      logger.info("Signature verification complete", { walletAddress, isValid });
      return isValid;
    } catch (verifyError) {
      logger.error("Verification error", { 
        error: verifyError instanceof Error ? verifyError.message : String(verifyError),
        stack: verifyError instanceof Error ? verifyError.stack : undefined
      });
      return false;
    }
  } catch (error) {
    logger.error("Signature verification error", { 
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    return false;
  }
}

// =============================================================================
// JWT Token Management
// =============================================================================

/**
 * Generate access and refresh tokens for a user
 */
export function generateTokens(userId: string, walletAddress: string): AuthTokens {
  const accessExpiresInMs = parseDuration(ACCESS_TOKEN_EXPIRES_IN);
  const refreshExpiresInMs = parseDuration(REFRESH_TOKEN_EXPIRES_IN);
  const accessExpiresIn = Math.floor(accessExpiresInMs / 1000);
  const refreshExpiresIn = Math.floor(refreshExpiresInMs / 1000);
  
  const accessPayload: Omit<JwtPayload, "iat" | "exp"> = {
    sub: userId,
    wallet: walletAddress,
    type: "access"
  };
  
  const refreshPayload: Omit<JwtPayload, "iat" | "exp"> = {
    sub: userId,
    wallet: walletAddress,
    type: "refresh"
  };
  
  const accessToken = jwt.sign(accessPayload, JWT_SECRET, {
    expiresIn: accessExpiresIn
  });
  
  const refreshToken = jwt.sign(refreshPayload, JWT_REFRESH_SECRET, {
    expiresIn: refreshExpiresIn
  });
  
  return {
    accessToken,
    refreshToken,
    expiresIn: accessExpiresIn
  };
}

/**
 * Verify an access token
 */
export function verifyAccessToken(token: string): JwtPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;
    
    if (decoded.type !== "access") {
      logger.warn("Invalid token type for access", { type: decoded.type });
      return null;
    }
    
    return decoded;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      logger.debug("Access token expired");
    } else if (error instanceof jwt.JsonWebTokenError) {
      logger.warn("Invalid access token", { error: error.message });
    }
    return null;
  }
}

/**
 * Verify a refresh token
 */
export function verifyRefreshToken(token: string): JwtPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_REFRESH_SECRET) as JwtPayload;
    
    if (decoded.type !== "refresh") {
      logger.warn("Invalid token type for refresh", { type: decoded.type });
      return null;
    }
    
    return decoded;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      logger.debug("Refresh token expired");
    } else if (error instanceof jwt.JsonWebTokenError) {
      logger.warn("Invalid refresh token", { error: error.message });
    }
    return null;
  }
}

/**
 * Hash a refresh token for secure storage
 */
export function hashRefreshToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// =============================================================================
// Express Middleware
// =============================================================================

/**
 * Authentication middleware - requires valid access token
 * Attaches user info to request object
 */
export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ 
      ok: false, 
      error: "Authentication required",
      code: "AUTH_REQUIRED"
    });
    return;
  }
  
  const token = authHeader.substring(7); // Remove "Bearer "
  const payload = verifyAccessToken(token);
  
  if (!payload) {
    res.status(401).json({ 
      ok: false, 
      error: "Invalid or expired token",
      code: "INVALID_TOKEN"
    });
    return;
  }
  
  req.user = {
    id: payload.sub,
    walletAddress: payload.wallet,
    username: null,
    displayName: null,
    avatarPatchId: null,
    bio: null
  };
  
  logger.debug("Authenticated request", { userId: payload.sub, wallet: payload.wallet });
  next();
}

/**
 * Optional authentication middleware
 * Attaches user info if token is valid, but doesn't require it
 */
export function optionalAuth(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization;
  
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.substring(7);
    const payload = verifyAccessToken(token);
    
    if (payload) {
      req.user = {
        id: payload.sub,
        walletAddress: payload.wallet,
        username: null,
        displayName: null,
        avatarPatchId: null,
        bio: null
      };
    }
  }
  
  next();
}

// =============================================================================
// Auth Service Functions
// =============================================================================

/**
 * Create or update nonce for a wallet address
 */
export async function createNonce(
  prisma: PrismaClient,
  walletAddress: string
): Promise<{ nonce: string; message: string; expiresAt: Date }> {
  const nonce = generateNonce();
  const expiresAt = new Date(Date.now() + NONCE_EXPIRES_IN_MS);
  const message = createSignMessage(nonce, walletAddress);
  
  // Upsert user with new nonce
  await prisma.user.upsert({
    where: { walletAddress: walletAddress.toLowerCase() },
    create: {
      walletAddress: walletAddress.toLowerCase(),
      nonce,
      nonceExpiresAt: expiresAt
    },
    update: {
      nonce,
      nonceExpiresAt: expiresAt
    }
  });
  
  logger.info("Nonce created", { walletAddress, expiresAt });
  
  return { nonce, message, expiresAt };
}

/**
 * Authenticate user with wallet signature
 * Creates new user if doesn't exist
 */
export async function authenticateWithWallet(
  prisma: PrismaClient,
  walletAddress: string,
  signature: string
): Promise<{ user: User; tokens: AuthTokens } | { error: string; code: string }> {
  const normalizedAddress = walletAddress.toLowerCase();
  
  // Get user with nonce
  const user = await prisma.user.findUnique({
    where: { walletAddress: normalizedAddress }
  });
  
  if (!user || !user.nonce) {
    return { 
      error: "Nonce not found. Please request a new nonce first.", 
      code: "NONCE_NOT_FOUND" 
    };
  }
  
  // Check nonce expiration
  if (user.nonceExpiresAt && user.nonceExpiresAt < new Date()) {
    return { 
      error: "Nonce expired. Please request a new nonce.", 
      code: "NONCE_EXPIRED" 
    };
  }
  
  // Verify signature
  const message = createSignMessage(user.nonce, walletAddress);
  const isValid = await verifySuiSignature(walletAddress, message, signature);
  
  if (!isValid) {
    logger.warn("Invalid signature", { walletAddress });
    return { 
      error: "Invalid signature", 
      code: "INVALID_SIGNATURE" 
    };
  }
  
  // Generate tokens
  const tokens = generateTokens(user.id, normalizedAddress);
  const hashedRefreshToken = hashRefreshToken(tokens.refreshToken);
  const refreshTokenExpiresAt = new Date(Date.now() + parseDuration(REFRESH_TOKEN_EXPIRES_IN));
  
  // Update user: clear nonce, set refresh token, update last login
  const updatedUser = await prisma.user.update({
    where: { id: user.id },
    data: {
      nonce: null,
      nonceExpiresAt: null,
      refreshToken: hashedRefreshToken,
      refreshTokenExpiresAt,
      lastLoginAt: new Date()
    }
  });
  
  logger.info("User authenticated", { userId: user.id, walletAddress: normalizedAddress });
  
  return { user: updatedUser, tokens };
}

/**
 * Refresh access token using refresh token
 */
export async function refreshAccessToken(
  prisma: PrismaClient,
  refreshToken: string
): Promise<{ tokens: AuthTokens } | { error: string; code: string }> {
  // Verify refresh token
  const payload = verifyRefreshToken(refreshToken);
  
  if (!payload) {
    return { 
      error: "Invalid or expired refresh token", 
      code: "INVALID_REFRESH_TOKEN" 
    };
  }
  
  // Get user
  const user = await prisma.user.findUnique({
    where: { id: payload.sub }
  });
  
  if (!user) {
    return { 
      error: "User not found", 
      code: "USER_NOT_FOUND" 
    };
  }
  
  // Verify refresh token matches stored hash
  const hashedToken = hashRefreshToken(refreshToken);
  if (user.refreshToken !== hashedToken) {
    logger.warn("Refresh token mismatch", { userId: user.id });
    return { 
      error: "Invalid refresh token", 
      code: "TOKEN_MISMATCH" 
    };
  }
  
  // Check if refresh token is expired in DB
  if (user.refreshTokenExpiresAt && user.refreshTokenExpiresAt < new Date()) {
    return { 
      error: "Refresh token expired", 
      code: "REFRESH_TOKEN_EXPIRED" 
    };
  }
  
  // Generate new tokens
  const tokens = generateTokens(user.id, user.walletAddress);
  const newHashedRefreshToken = hashRefreshToken(tokens.refreshToken);
  const refreshTokenExpiresAt = new Date(Date.now() + parseDuration(REFRESH_TOKEN_EXPIRES_IN));
  
  // Update user with new refresh token
  await prisma.user.update({
    where: { id: user.id },
    data: {
      refreshToken: newHashedRefreshToken,
      refreshTokenExpiresAt
    }
  });
  
  logger.info("Token refreshed", { userId: user.id });
  
  return { tokens };
}

/**
 * Logout user by invalidating refresh token
 */
export async function logout(
  prisma: PrismaClient,
  userId: string
): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: {
      refreshToken: null,
      refreshTokenExpiresAt: null
    }
  });
  
  logger.info("User logged out", { userId });
}

/**
 * Get user profile by ID
 */
export async function getUserProfile(
  prisma: PrismaClient,
  userId: string
): Promise<User | null> {
  return prisma.user.findUnique({
    where: { id: userId }
  });
}

/**
 * Update user profile
 */
export async function updateUserProfile(
  prisma: PrismaClient,
  userId: string,
  data: {
    username?: string;
    displayName?: string;
    bio?: string;
    avatarBlobId?: string;
    avatarPatchId?: string;
  }
): Promise<User> {
  // Validate username uniqueness if provided
  if (data.username) {
    const existing = await prisma.user.findFirst({
      where: {
        username: data.username.toLowerCase(),
        NOT: { id: userId }
      }
    });
    
    if (existing) {
      const error = new Error("Username already taken") as any;
      error.status = 400;
      error.code = "USERNAME_TAKEN";
      throw error;
    }
    
    data.username = data.username.toLowerCase();
  }
  
  return prisma.user.update({
    where: { id: userId },
    data
  });
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Validate Sui wallet address format
 */
export function isValidSuiAddress(address: string): boolean {
  // Sui addresses are 66 characters: 0x + 64 hex chars
  return /^0x[a-fA-F0-9]{64}$/.test(address);
}

/**
 * Normalize wallet address to lowercase
 */
export function normalizeAddress(address: string): string {
  return address.toLowerCase();
}

export default {
  generateNonce,
  createSignMessage,
  verifySuiSignature,
  generateTokens,
  verifyAccessToken,
  verifyRefreshToken,
  requireAuth,
  optionalAuth,
  createNonce,
  authenticateWithWallet,
  refreshAccessToken,
  logout,
  getUserProfile,
  updateUserProfile,
  isValidSuiAddress,
  normalizeAddress
};
