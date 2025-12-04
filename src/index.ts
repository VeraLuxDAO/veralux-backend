import "dotenv/config";
import express from "express";
import cors from "cors";
import multer from "multer";
import swaggerUi from "swagger-ui-express";
import { PrismaClient } from "@prisma/client";
import { createLogger } from "./logger.js";
import {
  assertNoExternalLinks,
  authLoginSchema,
  authNonceSchema,
  authRefreshSchema,
  postChatSchema,
  postFlowTextSchema,
  postGlowSchema,
  postGroupSchema,
  postJoinSchema,
  postPromoteSchema,
  updateProfileSchema
} from "./validators.js";
import {
  storeActionObject,
  storeChatObject,
  storeFlowObject,
  storeGroupMeta,
  walrusIO
} from "./walrus.js";
import { create_group, join_group, log_action, onChainEvent, verify_action } from "./blockchain.js";
import type { ActionObject, ChatObject, FlowObject, GroupMetaObject, UserProfile, WalrusPatchId } from "./types.js";
import { ActionType } from "./types.js";
import { swaggerSpec } from "./swagger.js";
import {
  authenticateWithWallet,
  createNonce,
  getUserProfile,
  isValidSuiAddress,
  logout,
  optionalAuth,
  refreshAccessToken,
  requireAuth,
  updateUserProfile,
  type AuthenticatedRequest
} from "./auth.js";

const logger = createLogger("api");
logger.info("Initializing Prisma client");
const prisma = new PrismaClient();

// Test database connection
prisma.$connect()
  .then(() => logger.info("Database connected successfully"))
  .catch((err) => {
    logger.error("Database connection failed", { error: err.message });
    process.exit(1);
  });

// Catch unhandled errors
process.on("unhandledRejection", (reason, promise) => {
  logger.error("Unhandled Promise Rejection", { reason: String(reason), promise: String(promise) });
  console.error("Unhandled Rejection:", reason);
});

process.on("uncaughtException", (error) => {
  logger.error("Uncaught Exception", { error: error.message, stack: error.stack });
  console.error("Uncaught Exception:", error);
  process.exit(1);
});

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB

// CORS configuration
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false
}));
app.use(express.json({ limit: "2mb" }));

/* ------------------------------ SWAGGER UI ------------------------------- */
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customSiteTitle: "YNX Backend API",
  customCss: ".swagger-ui .topbar { display: none }",
}));

/* ------------------------------ SSE: /events ------------------------------ */
type SSEClient = { id: number; res: express.Response };
const clients = new Map<number, SSEClient>();
let nextClientId = 1;

app.get("/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.flushHeaders?.();
  const id = nextClientId++;
  clients.set(id, { id, res });
  logger.info("SSE client connected", { clientId: id, totalClients: clients.size });
  const iv = setInterval(() => res.write(`event: ping\ndata: {}\n\n`), 15000);
  req.on("close", () => {
    clearInterval(iv);
    clients.delete(id);
    logger.info("SSE client disconnected", { clientId: id, totalClients: clients.size });
  });
});

function broadcast(e: unknown) {
  const payload = `data: ${JSON.stringify(e)}\n\n`;
  clients.forEach(({ res }) => res.write(payload));
}
onChainEvent((e) => broadcast(e));

/* ========================================================================== */
/* AUTHENTICATION ENDPOINTS                                                   */
/* ========================================================================== */

/**
 * Helper: Convert User model to UserProfile response
 */
function toUserProfile(user: any): UserProfile {
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

// ============================================================================
// NONCE ENDPOINT (COMMENTED OUT - For future signature verification)
// ============================================================================
// /**
//  * GET /auth/nonce - Request a nonce for wallet authentication
//  * 
//  * @query walletAddress - The Sui wallet address (0x...)
//  * @returns nonce, message to sign, and expiration time
//  */
// app.get("/auth/nonce", async (req, res, next) => {
//   try {
//     const walletAddress = (req.query.walletAddress ?? "").toString();
//     
//     if (!walletAddress) {
//       return res.status(400).json({ 
//         ok: false, 
//         error: "walletAddress query parameter is required",
//         code: "MISSING_WALLET_ADDRESS"
//       });
//     }
//     
//     if (!isValidSuiAddress(walletAddress)) {
//       return res.status(400).json({ 
//         ok: false, 
//         error: "Invalid Sui wallet address format",
//         code: "INVALID_WALLET_ADDRESS"
//       });
//     }
//     
//     const result = await createNonce(prisma, walletAddress);
//     
//     res.json({
//       ok: true,
//       nonce: result.nonce,
//       message: result.message,
//       expiresAt: result.expiresAt.toISOString()
//     });
//   } catch (err) {
//     next(err);
//   }
// });

// ============================================================================
// SIGN ENDPOINT (COMMENTED OUT - For testing signature verification)
// ============================================================================
// /**
//  * GET /auth/sign - Generate signature for testing (DEVELOPMENT ONLY)
//  * 
//  * This endpoint signs a message using the server's private key from SUI_PRIVATE_KEY.
//  * DO NOT USE IN PRODUCTION - This is only for testing the auth flow.
//  * 
//  * @query message - The message to sign
//  * @returns signature in base64 format
//  */
// app.get("/auth/sign", async (req, res, next) => {
//   try {
//     if (process.env.NODE_ENV === "production") {
//       return res.status(403).json({
//         ok: false,
//         error: "This endpoint is disabled in production",
//         code: "FORBIDDEN"
//       });
//     }

//     const message = (req.query.message ?? "").toString();
//     
//     if (!message) {
//       return res.status(400).json({
//         ok: false,
//         error: "message query parameter is required",
//         code: "MISSING_MESSAGE"
//       });
//     }

//     const privateKey = process.env.SUI_PRIVATE_KEY;
//     if (!privateKey) {
//       return res.status(500).json({
//         ok: false,
//         error: "SUI_PRIVATE_KEY not configured",
//         code: "NO_PRIVATE_KEY"
//       });
//     }

//     // Import required modules
//     const crypto = await import("node:crypto");
//     const { Ed25519Keypair } = await import("@mysten/sui/keypairs/ed25519");
//     const { toBase64 } = await import("@mysten/sui/utils");

//     // Create keypair from private key
//     const keypair = Ed25519Keypair.fromSecretKey(privateKey);
//     const walletAddress = keypair.toSuiAddress();

//     // Sui personal message format: intent bytes [3, 0, 0] + message
//     const intentBytes = new Uint8Array([3, 0, 0]);
//     const messageBytes = new TextEncoder().encode(message);
//     const fullMessage = new Uint8Array(intentBytes.length + messageBytes.length);
//     fullMessage.set(intentBytes);
//     fullMessage.set(messageBytes, intentBytes.length);

//     // Hash with SHA-256
//     const hash = crypto.default.createHash("sha256").update(fullMessage).digest();

//     // Sign the hash
//     const signatureBytes = await keypair.sign(hash);

//     // Format: [scheme_flag (0x00 for Ed25519)] + [signature (64 bytes)] + [public_key (32 bytes)]
//     const publicKey = keypair.getPublicKey();
//     const publicKeyBytes = publicKey.toRawBytes();
//     const fullSignature = new Uint8Array(1 + signatureBytes.length + publicKeyBytes.length);
//     fullSignature[0] = 0x00; // Ed25519 scheme flag
//     fullSignature.set(signatureBytes, 1);
//     fullSignature.set(publicKeyBytes, 1 + signatureBytes.length);

//     const signature = toBase64(fullSignature);

//     res.json({
//       ok: true,
//       signature,
//       walletAddress,
//       message,
//       note: "⚠️ This is for testing only. In production, users sign with their wallet."
//     });
//   } catch (err) {
//     logger.error("Sign endpoint error", err);
//     next(err);
//   }
// });

// ============================================================================
// SIGNATURE-BASED AUTH (COMMENTED OUT - Future implementation)
// ============================================================================
// /**
//  * POST /auth - Authenticate with wallet signature (Sign-in / Sign-up)
//  * 
//  * If user doesn't exist, creates a new account.
//  * If user exists, logs them in.
//  * 
//  * @body walletAddress - The Sui wallet address
//  * @body signature - The signature of the nonce message
//  * @returns Access token, refresh token, and user profile
//  */
// app.post("/auth", async (req, res, next) => {
//   try {
//     const parsed = authLoginSchema.parse(req.body);
//     
//     const result = await authenticateWithWallet(
//       prisma,
//       parsed.walletAddress,
//       parsed.signature
//     );
//     
//     if ("error" in result) {
//       return res.status(401).json({
//         ok: false,
//         error: result.error,
//         code: result.code
//       });
//     }
//     
//     const { user, tokens } = result;
//     
//     logger.info("User authenticated", { 
//       userId: user.id, 
//       wallet: user.walletAddress,
//       isNewUser: !user.username 
//     });
//     
//     res.json({
//       ok: true,
//       accessToken: tokens.accessToken,
//       refreshToken: tokens.refreshToken,
//       expiresIn: tokens.expiresIn,
//       user: toUserProfile(user)
//     });
//   } catch (err) {
//     next(err);
//   }
// });

/**
 * POST /auth - Simple wallet-based login (Temporary - No signature verification)
 * 
 * Creates or logs in user by wallet address only.
 * TODO: Implement signature verification in the future.
 * 
 * @body walletAddress - The Sui wallet address
 * @returns Access token, refresh token, and user profile
 */
app.post("/auth", async (req, res, next) => {
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
    const { generateTokens } = await import("./auth.js");
    const tokens = generateTokens(user.id, normalizedAddress);
    const { hashRefreshToken } = await import("./auth.js");
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
app.post("/auth/refresh", async (req, res, next) => {
  try {
    const parsed = authRefreshSchema.parse(req.body);
    
    const result = await refreshAccessToken(prisma, parsed.refreshToken);
    
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
 * 
 * Requires authentication
 */
app.post("/auth/logout", requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }
    
    await logout(prisma, req.user.id);
    
    res.json({ ok: true, message: "Logged out successfully" });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /auth/me - Get current user profile
 * 
 * Requires authentication
 */
app.get("/auth/me", requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }
    
    const user = await getUserProfile(prisma, req.user.id);
    
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

/**
 * PATCH /auth/me - Update current user profile
 * 
 * Requires authentication
 * @body username - Optional new username
 * @body displayName - Optional new display name
 * @body bio - Optional new bio
 */
app.patch("/auth/me", requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }
    
    const parsed = updateProfileSchema.parse(req.body);
    
    const user = await updateUserProfile(prisma, req.user.id, parsed);
    
    logger.info("User profile updated", { userId: user.id });
    
    res.json({
      ok: true,
      user: toUserProfile(user)
    });
  } catch (err: any) {
    if (err.code === "USERNAME_TAKEN") {
      return res.status(400).json({ 
        ok: false, 
        error: err.message,
        code: err.code 
      });
    }
    next(err);
  }
});

/**
 * POST /auth/me/avatar - Upload user avatar
 * 
 * Requires authentication
 * Accepts multipart/form-data with 'avatar' field
 */
app.post("/auth/me/avatar", requireAuth, upload.single("avatar"), async (req: AuthenticatedRequest, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }
    
    if (!req.file) {
      return res.status(400).json({ ok: false, error: "No avatar file provided" });
    }
    
    // Validate file type
    const allowedMimes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
    if (!allowedMimes.includes(req.file.mimetype)) {
      return res.status(400).json({ 
        ok: false, 
        error: "Invalid file type. Allowed: JPEG, PNG, GIF, WebP" 
      });
    }
    
    // Upload to Walrus
    const upload = await walrusIO.putRaw(req.file.buffer, {
      identifier: `avatar-${req.user.id}`,
      mime: req.file.mimetype
    });
    
    // Update user profile
    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: {
        avatarBlobId: upload.blobId,
        avatarPatchId: upload.patchId
      }
    });
    
    logger.info("User avatar updated", { userId: user.id, patchId: upload.patchId });
    
    res.json({
      ok: true,
      avatarPatchId: upload.patchId,
      user: toUserProfile(user)
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /users/:walletAddress - Get public user profile by wallet address
 */
app.get("/users/:walletAddress", async (req, res, next) => {
  try {
    const { walletAddress } = req.params;
    
    if (!isValidSuiAddress(walletAddress)) {
      return res.status(400).json({ 
        ok: false, 
        error: "Invalid wallet address format" 
      });
    }
    
    const user = await prisma.user.findUnique({
      where: { walletAddress: walletAddress.toLowerCase() }
    });
    
    if (!user) {
      return res.status(404).json({ ok: false, error: "User not found" });
    }
    
    // Return public profile only
    res.json({
      ok: true,
      user: {
        id: user.id,
        walletAddress: user.walletAddress,
        username: user.username,
        displayName: user.displayName,
        avatarPatchId: user.avatarPatchId,
        bio: user.bio,
        createdAt: user.createdAt.toISOString()
      }
    });
  } catch (err) {
    next(err);
  }
});

/* ========================================================================== */
/* FLOWS                                                                      */
/* ========================================================================== */
/**
 * POST /flows - Create a new flow (text or image)
 * 
 * Stores in database:
 * - blobId: Walrus blob ID (the quilt container)
 * - patchId: Walrus patch ID (USE THIS TO FETCH DATA)
 * - imageBlobId: Walrus blob ID for image (IMAGE type only)
 * - imagePatchId: Walrus patch ID for image (USE THIS TO FETCH IMAGE)
 */
app.post("/flows", upload.single("image"), async (req, res, next) => {
  try {
    const nowISO = new Date().toISOString();

    // TEXT flow
    if (req.is("application/json")) {
      logger.info("POST /flows (text)", { textLength: req.body.text?.length });
      const parsed = postFlowTextSchema.parse(req.body);
      assertNoExternalLinks(parsed.text);

      const flowObj: FlowObject = { kind: "flow", type: "TEXT", text: parsed.text, createdAt: nowISO };
      const { blobId, patchId } = await storeFlowObject(flowObj);
      
      logger.info("Text flow stored in Walrus", { blobId, patchId });

      await prisma.flow.create({
        data: { 
          type: "TEXT", 
          blobId,      // Blob ID (container)
          patchId,     // Patch ID (USE THIS TO FETCH)
          createdAt: new Date() 
        }
      });

      const tx = await log_action(ActionType.FLOW, patchId);
      logger.info("Text flow created", { blobId, patchId });
      
      return res.status(201).json({ 
        ok: true, 
        type: "TEXT",
        blobId,
        patchId,
        tx 
      });
    }

    // IMAGE flow
    if (!req.file) {
      return res.status(400).json({ ok: false, error: "Provide JSON {text} or multipart with 'image'." });
    }
    
    logger.info("POST /flows (image)", { size: req.file.size, mime: req.file.mimetype });
    const caption = (req.body?.caption ?? "").toString();
    assertNoExternalLinks(caption);

    // 1. Upload image to Walrus
    const imageUpload = await walrusIO.putRaw(req.file.buffer, {
      identifier: req.file.originalname,
      mime: req.file.mimetype,
    });
    logger.info("Image uploaded to Walrus", { 
      imageBlobId: imageUpload.blobId, 
      imagePatchId: imageUpload.patchId 
    });
    
    // 2. Store flow metadata JSON (references the image patchId)
    const flowObj: FlowObject = {
      kind: "flow",
      type: "IMAGE",
      imagePatchId: imageUpload.patchId,  // Reference to image
      mime: req.file.mimetype,
      ...(caption ? { caption } : {}),
      createdAt: nowISO
    };
    const { blobId, patchId } = await storeFlowObject(flowObj);
    logger.info("Flow metadata stored in Walrus", { blobId, patchId });

    // 3. Save to database with CORRECT values
    await prisma.flow.create({
      data: { 
        type: "IMAGE", 
        blobId,                          // Flow metadata blob ID
        patchId,                         // Flow metadata patch ID
        imageBlobId: imageUpload.blobId, // Image blob ID
        imagePatchId: imageUpload.patchId, // Image patch ID (USE THIS TO FETCH IMAGE!)
        mime: req.file.mimetype, 
        createdAt: new Date() 
      }
    });
    logger.info("Image flow saved to DB", { blobId, patchId, imagePatchId: imageUpload.patchId });

    const tx = await log_action(ActionType.FLOW, patchId);
    
    return res.status(201).json({ 
      ok: true, 
      type: "IMAGE",
      blobId,
      patchId,
      imageBlobId: imageUpload.blobId,
      imagePatchId: imageUpload.patchId,
      tx 
    });
  } catch (err) {
    logger.error("POST /flows failed", err);
    next(err);
  }
});

/**
 * GET /flows - List flows with pagination
 * 
 * Returns:
 * - patchId: Use to fetch flow metadata
 * - imagePatchId: Use to fetch image (for IMAGE type)
 * - glowCount: Number of glows on this flow
 * - promoteCount: Number of promotes on this flow
 */
app.get("/flows", async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 50);
    const cursorIso = req.query.cursor ? new Date(String(req.query.cursor)) : null;

    const rows = await prisma.flow.findMany({
      where: cursorIso ? { createdAt: { lt: cursorIso } } : undefined,
      orderBy: { createdAt: "desc" },
      take: limit + 1
    });

    const slice = rows.slice(0, limit);
    logger.debug("GET /flows", { count: slice.length });

    const items = await Promise.all(slice.map(async (r) => {
      try {
        // Fetch flow metadata from Walrus using patchId
        const flex = await walrusIO.readFlexible(r.patchId);
        
        let flowData: any = null;
        if (r.type === "TEXT") {
          if (flex.kind === "json" && typeof flex.data?.text === "string") {
            flowData = { type: "TEXT", text: flex.data.text };
          } else if (flex.kind === "text") {
            flowData = { type: "TEXT", text: flex.data };
          } else {
            flowData = { type: "TEXT", text: "" };
          }
        } else if (r.type === "IMAGE") {
          flowData = { 
            type: "IMAGE", 
            imagePatchId: r.imagePatchId,  // From DB - correct value!
            caption: flex.kind === "json" ? flex.data?.caption : undefined,
            mime: r.mime || "image/jpeg" 
          };
        }
        
        // Get glow and promote counts
        const [glowCount, promoteCount] = await Promise.all([
          prisma.glow.count({ where: { flowPatchId: r.patchId } }),
          prisma.promote.count({ where: { flowPatchId: r.patchId } })
        ]);
        
        return { 
          blobId: r.blobId,
          patchId: r.patchId,
          imageBlobId: r.imageBlobId,
          imagePatchId: r.imagePatchId,
          createdAt: r.createdAt.toISOString(),
          glowCount,
          promoteCount,
          flow: flowData 
        };
      } catch (err) {
        logger.error("Failed to load flow", { patchId: r.patchId, error: err instanceof Error ? err.message : String(err) });
        return { 
          blobId: r.blobId,
          patchId: r.patchId,
          imageBlobId: r.imageBlobId,
          imagePatchId: r.imagePatchId,
          createdAt: r.createdAt.toISOString(),
          glowCount: 0,
          promoteCount: 0,
          flow: null 
        };
      }
    }));

    const nextCursor = rows.length > limit ? rows[limit].createdAt.toISOString() : null;
    res.json({ ok: true, items, nextCursor });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /image/:patchId - Fetch image from Walrus
 * 
 * Use imagePatchId from flow to fetch the actual image!
 */
app.get("/image/:patchId", async (req, res, next) => {
  try {
    const patchId = req.params.patchId;
    logger.debug("GET /image/:patchId", { patchId });
    
    const { data, identifier, contentType } = await walrusIO.fetchByPatchId(patchId);
    
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.send(data);
    
    logger.info("Image served", { patchId, size: data.length, contentType });
  } catch (err) {
    logger.error("GET /image/:patchId failed", { patchId: req.params.patchId, error: err instanceof Error ? err.message : String(err) });
    res.status(404).json({ ok: false, error: "Image not found" });
  }
});

/* --------------------------- GLOWS & PROMOTES ---------------------------- */
app.post("/glows", requireAuth, async (req, res, next) => {
  try {
    const { flowPatchId } = postGlowSchema.parse(req.body);
    const actorId = req.user!.id; // From authenticated user
    
    // Find flow by patchId
    const flow = await prisma.flow.findUnique({ where: { patchId: flowPatchId } });
    if (!flow) return res.status(404).json({ ok: false, error: "Flow not found" });

    // Check if user already glowed this flow
    const existing = await prisma.glow.findFirst({
      where: { flowPatchId, actorId }
    });
    if (existing) {
      return res.status(400).json({ ok: false, error: "You already glowed this flow" });
    }

    const actionObj: ActionObject = {
      kind: "action",
      action: ActionType.GLOW,
      flowPatchId,
      actorId,
      createdAt: new Date().toISOString()
    };
    const { blobId, patchId } = await storeActionObject(actionObj);

    await prisma.glow.create({ 
      data: { 
        flowPatchId,
        blobId,
        patchId,
        actorId, 
        createdAt: new Date() 
      } 
    });
    
    const tx = await log_action(ActionType.GLOW, patchId, actorId);
    res.status(201).json({ ok: true, blobId, patchId, tx });
  } catch (err) {
    next(err);
  }
});

app.post("/promotes", requireAuth, async (req, res, next) => {
  try {
    const { flowPatchId } = postPromoteSchema.parse(req.body);
    const actorId = req.user!.id; // From authenticated user
    
    const flow = await prisma.flow.findUnique({ where: { patchId: flowPatchId } });
    if (!flow) return res.status(404).json({ ok: false, error: "Flow not found" });

    // Check if user already promoted this flow
    const existing = await prisma.promote.findFirst({
      where: { flowPatchId, actorId }
    });
    if (existing) {
      return res.status(400).json({ ok: false, error: "You already promoted this flow" });
    }

    const actionObj: ActionObject = {
      kind: "action",
      action: ActionType.PROMOTE,
      flowPatchId,
      actorId,
      visibilityBoost: 10,
      createdAt: new Date().toISOString()
    };
    const { blobId, patchId } = await storeActionObject(actionObj);

    await prisma.promote.create({
      data: { 
        flowPatchId,
        blobId,
        patchId,
        actorId, 
        visibilityBoost: 10, 
        createdAt: new Date() 
      }
    });
    
    const tx = await log_action(ActionType.PROMOTE, patchId, actorId);
    res.status(201).json({ ok: true, blobId, patchId, tx });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------ GROUPS API ------------------------------- */
app.get("/groups/rooms", async (req, res, next) => {
  try {
    const rooms = await prisma.group.findMany({
      where: { type: "room" },
      orderBy: { createdAt: "desc" }
    });
    res.json({ ok: true, groups: rooms });
  } catch (err) {
    next(err);
  }
});

app.get("/groups/circles", async (req, res, next) => {
  try {
    const circles = await prisma.group.findMany({
      where: { type: "circle" },
      orderBy: { createdAt: "desc" }
    });
    res.json({ ok: true, groups: circles });
  } catch (err) {
    next(err);
  }
});

app.get("/groups", async (req, res, next) => {
  try {
    const groups = await prisma.group.findMany({
      orderBy: { createdAt: "desc" }
    });
    res.json({ ok: true, groups });
  } catch (err) {
    next(err);
  }
});

app.post("/rooms", async (req, res, next) => {
  try {
    const { type, name } = postGroupSchema.parse({ ...req.body, type: "room" });
    const gMeta: GroupMetaObject = { kind: "groupMeta", type, name, createdAt: new Date().toISOString() };
    const { blobId, patchId } = await storeGroupMeta(gMeta);

    const created = await create_group(type, name);
    const row = await prisma.group.create({
      data: { groupId: created.chainGroupId, type, name, blobId, patchId }
    });

    res.status(201).json({ ok: true, group: row, blobId, patchId, tx: created.tx });
  } catch (err) {
    next(err);
  }
});

app.post("/circles", async (req, res, next) => {
  try {
    const { type, name } = postGroupSchema.parse({ ...req.body, type: "circle" });
    const gMeta: GroupMetaObject = { kind: "groupMeta", type, name, createdAt: new Date().toISOString() };
    const { blobId, patchId } = await storeGroupMeta(gMeta);

    const created = await create_group(type, name);
    const row = await prisma.group.create({
      data: { groupId: created.chainGroupId, type, name, blobId, patchId }
    });

    res.status(201).json({ ok: true, group: row, blobId, patchId, tx: created.tx });
  } catch (err) {
    next(err);
  }
});

app.post("/join", requireAuth, async (req, res, next) => {
  try {
    const { groupId } = postJoinSchema.parse(req.body);
    const memberId = req.user!.id; // Use authenticated user's ID
    
    const group = await prisma.group.findUnique({ where: { groupId } });
    if (!group) return res.status(404).json({ ok: false, error: "Group not found" });

    // Check if already a member
    const existing = await prisma.membership.findFirst({
      where: { groupId, memberId }
    });
    if (existing) {
      return res.status(400).json({ ok: false, error: "You are already a member of this group" });
    }

    const tx = await join_group(groupId, memberId);
    const m = await prisma.membership.create({ data: { groupId, memberId } });
    res.status(201).json({ ok: true, membership: m, tx });
  } catch (err) {
    next(err);
  }
});

/* --------------------------------- CHAT ---------------------------------- */
app.get("/chat", async (req, res, next) => {
  try {
    const groupId = req.query.groupId?.toString();
    const limit = Math.min(parseInt(req.query.limit?.toString() || "50"), 100);
    const offset = parseInt(req.query.offset?.toString() || "0");

    if (!groupId) {
      return res.status(400).json({ ok: false, error: "groupId query parameter is required" });
    }

    // Fetch messages from database with user info
    const messages = await prisma.chat.findMany({
      where: { groupId },
      include: {
        actor: {
          select: {
            id: true,
            walletAddress: true,
            displayName: true,
            username: true,
            avatarPatchId: true
          }
        }
      },
      orderBy: { createdAt: "asc" },
      take: limit,
      skip: offset
    });

    // Format response to match frontend expectations
    const formattedMessages = messages.map(msg => ({
      patchId: msg.patchId,
      blobId: msg.blobId,
      text: msg.text,
      groupId: msg.groupId,
      actorId: msg.actorId,
      user: msg.actor,
      createdAt: msg.createdAt.toISOString()
    }));
    
    res.json({
      ok: true,
      messages: formattedMessages,
      groupId,
      limit,
      offset,
      total: formattedMessages.length
    });
  } catch (err) {
    next(err);
  }
});

app.post("/chat", requireAuth, async (req, res, next) => {
  try {
    const { text, groupId } = postChatSchema.parse(req.body);
    const actorId = req.user!.id; // From authenticated user
    assertNoExternalLinks(text);

    const chatObj: ChatObject = { 
      kind: "chat", 
      text, 
      groupId, 
      actorId, 
      createdAt: new Date().toISOString() 
    };
    const { blobId, patchId } = await storeChatObject(chatObj);

    // Save to database
    await prisma.chat.create({
      data: {
        groupId,
        text,
        blobId,
        patchId,
        actorId,
        createdAt: new Date()
      }
    });

    const tx = await log_action(ActionType.CHAT, patchId, actorId);
    
    res.status(201).json({ 
      ok: true, 
      message: {
        patchId,
        blobId,
        text,
        groupId,
        actorId,
        user: {
          id: req.user!.id,
          walletAddress: req.user!.walletAddress,
          displayName: req.user!.displayName,
          username: req.user!.username,
          avatarPatchId: req.user!.avatarPatchId
        },
        createdAt: chatObj.createdAt
      },
      tx 
    });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------ VERIFY & HEALTH -------------------------- */
app.get("/verify", async (req, res, next) => {
  try {
    const patchId = (req.query.patchId ?? "").toString();
    if (!patchId) return res.status(400).json({ ok: false, error: "patchId is required" });
    const result = await verify_action(patchId as WalrusPatchId);
    return res.json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error("Request error", { method: req.method, path: req.path, error: err?.message });
  res.status((err && err.status) || 500).json({ ok: false, error: err?.message ?? "Internal error" });
});

const PORT = Number(process.env.PORT || 4000);
app.listen(PORT, () => {
  logger.info("Server started", { port: PORT, walrusMode: process.env.WALRUS_MODE, chainMode: process.env.CHAIN_MODE });
  console.log(`Social Hub API :${PORT} — Walrus=${process.env.WALRUS_MODE}  Chain=${process.env.CHAIN_MODE}`);
});
