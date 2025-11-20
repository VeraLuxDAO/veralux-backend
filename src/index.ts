import "dotenv/config";
import express from "express";
import cors from "cors";
import multer from "multer";
import swaggerUi from "swagger-ui-express";
import { PrismaClient } from "@prisma/client";
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
  loadFlowObject,
  storeActionObject,
  storeChatObject,
  storeFlowObject,
  storeGroupMeta,
  walrus
} from "./walrus.js";
import { create_group, join_group, log_action, onChainEvent, verify_action } from "./blockchain.js";
import type { ActionObject, ChatObject, FlowObject, GroupMetaObject, WalrusHash } from "./types.js";
import { ActionType } from "./types.js";
import { swaggerSpec } from "./swagger.js";

const prisma = new PrismaClient();
const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB

app.use(cors());
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

/**
 * @swagger
 * /events:
 *   get:
 *     tags: [Events]
 *     summary: Server-Sent Events stream
 *     description: Subscribe to real-time blockchain events (ActionLogged, GroupCreated, GroupAction)
 *     responses:
 *       200:
 *         description: Event stream connection established
 *         content:
 *           text/event-stream:
 *             schema:
 *               type: string
 *               example: |
 *                 event: ping
 *                 data: {}
 *
 *                 data: {"type":"ActionLogged","action":"FLOW","walrusHash":"0a17dcff...","at":"2025-11-20T..."}
 */
app.get("/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  const id = nextClientId++;
  clients.set(id, { id, res });

  // Heartbeat
  const iv = setInterval(() => res.write(`event: ping\ndata: {}\n\n`), 15000);

  req.on("close", () => {
    clearInterval(iv);
    clients.delete(id);
  });
});

function broadcast(e: unknown) {
  const payload = `data: ${JSON.stringify(e)}\n\n`;
  clients.forEach(({ res }) => res.write(payload));
}
onChainEvent((e) => broadcast(e)); // tie chain events to SSE

/* -------------------------------- FLOWS ---------------------------------- */
/**
 * @swagger
 * /flows:
 *   post:
 *     tags: [Flows]
 *     summary: Create a new flow (text or image)
 *     description: |
 *       Post content as a flow. Supports both text (JSON) and image (multipart/form-data).
 *       Content is stored in Walrus and logged on the blockchain.
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/FlowTextRequest'
 *         multipart/form-data:
 *           schema:
 *             $ref: '#/components/schemas/FlowImageRequest'
 *     responses:
 *       201:
 *         description: Flow created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/FlowResponse'
 *       400:
 *         description: Invalid request or external links not allowed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
app.post("/flows", upload.single("image"), async (req, res, next) => {
  try {
    const nowISO = new Date().toISOString();

    if (req.is("application/json")) {
      const parsed = postFlowTextSchema.parse(req.body);
      assertNoExternalLinks(parsed.text);

      const flowObj: FlowObject = { kind: "flow", type: "TEXT", text: parsed.text, createdAt: nowISO };
      const flowHash = await storeFlowObject(flowObj);

      await prisma.flow.create({
        data: { type: "TEXT", walrusHash: flowHash, createdAt: new Date() }
      });

      const tx = await log_action(ActionType.FLOW, flowHash);
      return res.status(201).json({ ok: true, hash: flowHash, type: "TEXT", tx });
    }

    // multipart: image
    if (!req.file) {
      return res.status(400).json({ ok: false, error: "Provide JSON {text} or multipart with 'image'." });
    }
    const caption = (req.body?.caption ?? "").toString();
    assertNoExternalLinks(caption);

    const imageHash = await walrus.putRaw(req.file.buffer);
    const flowObj: FlowObject = {
      kind: "flow",
      type: "IMAGE",
      imageHash,
      mime: req.file.mimetype,
      ...(caption ? { caption } : {}),
      createdAt: nowISO
    };
    const flowHash = await storeFlowObject(flowObj);

    await prisma.flow.create({
      data: { type: "IMAGE", walrusHash: flowHash, imageHash, mime: req.file.mimetype, createdAt: new Date() }
    });

    const tx = await log_action(ActionType.FLOW, flowHash);
    return res.status(201).json({ ok: true, hash: flowHash, type: "IMAGE", imageHash, tx });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /flows:
 *   get:
 *     tags: [Flows]
 *     summary: List flows with pagination
 *     description: Get paginated list of flows (newest first), hydrated from Walrus
 *     parameters:
 *       - name: limit
 *         in: query
 *         schema:
 *           type: integer
 *           default: 20
 *           maximum: 50
 *         description: Maximum number of flows to return
 *       - name: cursor
 *         in: query
 *         schema:
 *           type: string
 *           format: date-time
 *         description: ISO datetime cursor for pagination
 *     responses:
 *       200:
 *         description: List of flows retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                 items:
 *                   type: array
 *                   items:
 *                     type: object
 *                 nextCursor:
 *                   type: string
 *                   nullable: true
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

    const items = await Promise.all(
      rows.slice(0, limit).map(async (r: { walrusHash: string; createdAt: { toISOString: () => any; }; }) => {
        const flow = await loadFlowObject(r.walrusHash as WalrusHash);
        return { hash: r.walrusHash, createdAt: r.createdAt.toISOString(), flow };
      })
    );

    const nextCursor = rows.length > limit ? rows[limit].createdAt.toISOString() : null;
    res.json({ ok: true, items, nextCursor });
  } catch (err) {
    next(err);
  }
});

/* --------------------------- GLOWS & PROMOTES ---------------------------- */
/**
 * @swagger
 * /glows:
 *   post:
 *     tags: [Social]
 *     summary: Glow (like) a flow
 *     description: Register a glow action for a flow (similar to a "like")
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/GlowRequest'
 *     responses:
 *       201:
 *         description: Glow created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                 hash:
 *                   type: string
 *                 tx:
 *                   $ref: '#/components/schemas/ChainTx'
 *       404:
 *         description: Flow not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
app.post("/glows", async (req, res, next) => {
  try {
    const { flowHash, actorId } = postGlowSchema.parse(req.body);
    const flow = await prisma.flow.findUnique({ where: { walrusHash: flowHash } });
    if (!flow) return res.status(404).json({ ok: false, error: "Flow not found" });

    const actionObj: ActionObject = {
      kind: "action",
      action: ActionType.GLOW,
      flowHash,
      actorId,
      createdAt: new Date().toISOString()
    };
    const actionHash = await storeActionObject(actionObj);

    await prisma.glow.create({ data: { walrusHash: actionHash, flowHash, actorId, createdAt: new Date() } });
    const tx = await log_action(ActionType.GLOW, actionHash, actorId);

    res.status(201).json({ ok: true, hash: actionHash, tx });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /promotes:
 *   post:
 *     tags: [Social]
 *     summary: Promote a flow
 *     description: Boost visibility of a flow (+10 visibility points)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/PromoteRequest'
 *     responses:
 *       201:
 *         description: Promote created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                 hash:
 *                   type: string
 *                 tx:
 *                   $ref: '#/components/schemas/ChainTx'
 *       404:
 *         description: Flow not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
app.post("/promotes", async (req, res, next) => {
  try {
    const { flowHash, actorId } = postPromoteSchema.parse(req.body);
    const flow = await prisma.flow.findUnique({ where: { walrusHash: flowHash } });
    if (!flow) return res.status(404).json({ ok: false, error: "Flow not found" });

    const actionObj: ActionObject = {
      kind: "action",
      action: ActionType.PROMOTE,
      flowHash,
      actorId,
      visibilityBoost: 10,
      createdAt: new Date().toISOString()
    };
    const actionHash = await storeActionObject(actionObj);

    await prisma.promote.create({
      data: { walrusHash: actionHash, flowHash, actorId, visibilityBoost: 10, createdAt: new Date() }
    });
    const tx = await log_action(ActionType.PROMOTE, actionHash, actorId);

    res.status(201).json({ ok: true, hash: actionHash, tx });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------ GROUPS API ------------------------------- */
/**
 * @swagger
 * /rooms:
 *   post:
 *     tags: [Groups]
 *     summary: Create a new room
 *     description: Create a public room group on the blockchain
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/GroupRequest'
 *     responses:
 *       201:
 *         description: Room created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                 group:
 *                   type: object
 *                 metaHash:
 *                   type: string
 *                 tx:
 *                   $ref: '#/components/schemas/ChainTx'
 */
app.post("/rooms", async (req, res, next) => {
  try {
    const { type, name } = postGroupSchema.parse({ ...req.body, type: "room" });
    // Walrus: store group metadata
    const gMeta: GroupMetaObject = { kind: "groupMeta", type, name, createdAt: new Date().toISOString() };
    const metaHash = await storeGroupMeta(gMeta);

    const created = await create_group(type, name);
    const row = await prisma.group.create({
      data: { groupId: created.chainGroupId, type, name }
    });

    // Optionally: store metaHash in DB if you add a column later
    res.status(201).json({ ok: true, group: row, metaHash, tx: created.tx });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /circles:
 *   post:
 *     tags: [Groups]
 *     summary: Create a new circle
 *     description: Create a private circle group on the blockchain
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/GroupRequest'
 *     responses:
 *       201:
 *         description: Circle created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                 group:
 *                   type: object
 *                 metaHash:
 *                   type: string
 *                 tx:
 *                   $ref: '#/components/schemas/ChainTx'
 */
app.post("/circles", async (req, res, next) => {
  try {
    const { type, name } = postGroupSchema.parse({ ...req.body, type: "circle" });
    const gMeta: GroupMetaObject = { kind: "groupMeta", type, name, createdAt: new Date().toISOString() };
    const metaHash = await storeGroupMeta(gMeta);

    const created = await create_group(type, name);
    const row = await prisma.group.create({
      data: { groupId: created.chainGroupId, type, name }
    });

    res.status(201).json({ ok: true, group: row, metaHash, tx: created.tx });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /join:
 *   post:
 *     tags: [Groups]
 *     summary: Join a group
 *     description: Add a member to a room or circle
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/JoinRequest'
 *     responses:
 *       201:
 *         description: Successfully joined group
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                 membership:
 *                   type: object
 *                 tx:
 *                   $ref: '#/components/schemas/ChainTx'
 *       404:
 *         description: Group not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
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
/**
 * @swagger
 * /chat:
 *   post:
 *     tags: [Chat]
 *     summary: Send a chat message 💬
 *     description: |
 *       **YES! This backend supports chat messaging!**
 *       
 *       Send messages to groups (rooms/circles) or general chat.
 *       Messages are stored in Walrus (content-addressed storage) and logged on the blockchain.
 *       Real-time events are broadcast via the /events SSE endpoint.
 *       
 *       Features:
 *       - Group-based messaging
 *       - Actor/user attribution
 *       - Immutable storage in Walrus
 *       - On-chain verification via Sui
 *       - Real-time SSE notifications
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ChatRequest'
 *           examples:
 *             groupMessage:
 *               summary: Message to a group
 *               value:
 *                 text: "Hello everyone! 👋"
 *                 groupId: "grp_room_123"
 *                 actorId: "user456"
 *             generalMessage:
 *               summary: General message (no group)
 *               value:
 *                 text: "Hello world!"
 *                 actorId: "user789"
 *     responses:
 *       201:
 *         description: Chat message sent successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ChatResponse'
 *             example:
 *               ok: true
 *               hash: "e986f1b088e7bf1a4fc3add93f71c5fe..."
 *               tx:
 *                 txId: "8xKpT9..."
 *                 network: "sui"
 *       400:
 *         description: Invalid request or external links not allowed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
app.post("/chat", async (req, res, next) => {
  try {
    const { text, groupId, actorId } = postChatSchema.parse(req.body);
    assertNoExternalLinks(text);

    const chatObj: ChatObject = { kind: "chat", text, groupId, actorId, createdAt: new Date().toISOString() };
    const chatHash = await storeChatObject(chatObj);

    // index minimally if you have a Chat table; otherwise skip DB
    // await prisma.chat.create({ data: { walrusHash: chatHash, groupId, actorId } });

    const tx = await log_action(ActionType.CHAT, chatHash, actorId);
    res.status(201).json({ ok: true, hash: chatHash, tx });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------ VERIFY HASH ------------------------------ */
/**
 * @swagger
 * /verify:
 *   get:
 *     tags: [Verification]
 *     summary: Verify action hash on blockchain
 *     description: Check if a Walrus hash has been logged on-chain (implementation depends on CHAIN_MODE)
 *     parameters:
 *       - name: hash
 *         in: query
 *         required: true
 *         schema:
 *           type: string
 *         description: Walrus hash to verify
 *         example: "0a17dcffcd3e1d9e6e12a81b2ba57003810a114a26b4e836733083f3460a7d3f"
 *     responses:
 *       200:
 *         description: Verification result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                 valid:
 *                   type: boolean
 *                   description: Whether the hash is verified on-chain
 *                 network:
 *                   type: string
 *                   enum: [stub, sui, evm]
 *             example:
 *               ok: true
 *               valid: true
 *               network: "sui"
 *       400:
 *         description: Hash parameter required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
app.get("/verify", async (req, res, next) => {
  try {
    const hash = (req.query.hash ?? "").toString();
    if (!hash) return res.status(400).json({ ok: false, error: "hash is required" });

    const result = await verify_action(hash as WalrusHash);
    return res.json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
});

/* --------------------------------- MISC ---------------------------------- */
/**
 * @swagger
 * /health:
 *   get:
 *     tags: [Health]
 *     summary: Health check endpoint
 *     description: Simple liveness check for the API
 *     responses:
 *       200:
 *         description: API is healthy
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *             example:
 *               ok: true
 */
app.get("/health", (_req, res) => res.json({ ok: true }));

app.use((err: any, _req: express.Request, res: express.Response) => {
  console.error(err);
  res.status((err && err.status) || 500).json({ ok: false, error: err?.message ?? "Internal error" });
});

const PORT = Number(process.env.PORT || 4000);
app.listen(PORT, () => {
  console.log(
    `Social Hub API :${PORT} — Walrus=${process.env.WALRUS_MODE}  Chain=${process.env.CHAIN_MODE}`
  );
});
