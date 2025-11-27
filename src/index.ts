import "dotenv/config";
import express from "express";
import cors from "cors";
import multer from "multer";
import swaggerUi from "swagger-ui-express";
import { PrismaClient } from "@prisma/client";
import { createLogger } from "./logger.js";
import {
  assertNoExternalLinks,
  postChatSchema,
  postFlowTextSchema,
  postGlowSchema,
  postGroupSchema,
  postJoinSchema,
  postPromoteSchema
} from "./validators.js";
import {
  storeActionObject,
  storeChatObject,
  storeFlowObject,
  storeGroupMeta,
  walrusIO
} from "./walrus.js";
import { create_group, join_group, log_action, onChainEvent, verify_action } from "./blockchain.js";
import type { ActionObject, ChatObject, FlowObject, GroupMetaObject, WalrusPatchId } from "./types.js";
import { ActionType } from "./types.js";
import { swaggerSpec } from "./swagger.js";

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

/* -------------------------------- FLOWS ---------------------------------- */
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
        
        return { 
          blobId: r.blobId,
          patchId: r.patchId,
          imageBlobId: r.imageBlobId,
          imagePatchId: r.imagePatchId,
          createdAt: r.createdAt.toISOString(), 
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
app.post("/glows", async (req, res, next) => {
  try {
    const { flowPatchId, actorId } = postGlowSchema.parse(req.body);
    
    // Find flow by patchId
    const flow = await prisma.flow.findUnique({ where: { patchId: flowPatchId } });
    if (!flow) return res.status(404).json({ ok: false, error: "Flow not found" });

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

app.post("/promotes", async (req, res, next) => {
  try {
    const { flowPatchId, actorId } = postPromoteSchema.parse(req.body);
    
    const flow = await prisma.flow.findUnique({ where: { patchId: flowPatchId } });
    if (!flow) return res.status(404).json({ ok: false, error: "Flow not found" });

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

app.post("/join", async (req, res, next) => {
  try {
    const { groupId, memberId } = postJoinSchema.parse(req.body);
    const group = await prisma.group.findUnique({ where: { groupId } });
    if (!group) return res.status(404).json({ ok: false, error: "Group not found" });

    const tx = await join_group(groupId, memberId);
    const m = await prisma.membership.create({ data: { groupId, memberId } });
    res.status(201).json({ ok: true, membership: m, tx });
  } catch (err) {
    next(err);
  }
});

/* --------------------------------- CHAT ---------------------------------- */
app.post("/chat", async (req, res, next) => {
  try {
    const { text, groupId, actorId } = postChatSchema.parse(req.body);
    assertNoExternalLinks(text);

    const chatObj: ChatObject = { kind: "chat", text, groupId, actorId, createdAt: new Date().toISOString() };
    const { blobId, patchId } = await storeChatObject(chatObj);

    const tx = await log_action(ActionType.CHAT, patchId, actorId);
    res.status(201).json({ ok: true, blobId, patchId, tx });
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
