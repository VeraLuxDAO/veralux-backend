import "dotenv/config";
import express from "express";
import multer from "multer";
import { PrismaClient } from "@prisma/client";
import { assertNoLinks, postFlowTextSchema, postGlowSchema, postPromoteSchema, postGroupSchema, postJoinSchema } from "./validators.js";
import { loadFlowObject, storeActionObject, storeFlowObject, walrus } from "./walrus.js";
import { create_group, join_group, log_action } from "./blockchain.js";
import type { FlowObject, ActionObject, WalrusHash } from "./types.js";

const prisma = new PrismaClient();
const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB

app.use(express.json({ limit: "2mb" }));

/**
 * POST /flows
 * - JSON {text} OR multipart "image" (file) + optional "caption"
 * - Stores content in Walrus, returns flow hash
 * - Validates: no links in text/caption
 */
app.post("/flows", upload.single("image"), async (req, res, next) => {
  try {
    const now = new Date().toISOString();

    if (req.is("application/json")) {
      const parsed = postFlowTextSchema.parse(req.body);
      assertNoLinks(parsed.text);

      const flowObj: FlowObject = { kind: "flow", type: "TEXT", text: parsed.text, createdAt: now };
      const flowHash = await storeFlowObject(flowObj);

      await prisma.flow.create({
        data: { type: "TEXT", walrusHash: flowHash, createdAt: new Date() }
      });

      return res.status(201).json({ ok: true, hash: flowHash, type: "TEXT" });
    }

    // multipart: image
    if (!req.file) {
      return res.status(400).json({ ok: false, error: "Provide JSON {text} or multipart with 'image'." });
    }
    const caption = (req.body?.caption ?? "").toString();
    assertNoLinks(caption);

    // store raw image first
    const imageHash = await walrus.putRaw(req.file.buffer);

    const flowObj: FlowObject = {
      kind: "flow",
      type: "IMAGE",
      imageHash,
      mime: req.file.mimetype,
      ...(caption ? { text: caption } : {}),
      createdAt: now
    };
    const flowHash = await storeFlowObject(flowObj);

    await prisma.flow.create({
      data: {
        type: "IMAGE",
        walrusHash: flowHash,
        imageHash,
        mime: req.file.mimetype,
        createdAt: new Date()
      }
    });

    return res.status(201).json({ ok: true, hash: flowHash, type: "IMAGE", imageHash });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /flows?limit=20&cursor=ISO
 * Returns chronological feed (newest first).
 * Hydrates content from Walrus so client can render.
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

/**
 * POST /glows
 * Body: { flowHash, actorId? }
 * - Stores an action log object in Walrus
 * - Emits blockchain stub log_action
 */
app.post("/glows", async (req, res, next) => {
  try {
    const { flowHash, actorId } = postGlowSchema.parse(req.body);
    // verify the flow exists
    const flow = await prisma.flow.findUnique({ where: { walrusHash: flowHash } });
    if (!flow) return res.status(404).json({ ok: false, error: "Flow not found" });

    const actionObj: ActionObject = { kind: "action", action: "GLOW", flowHash, actorId, createdAt: new Date().toISOString() };
    const actionHash = await storeActionObject(actionObj);

    await prisma.glow.create({ data: { walrusHash: actionHash, flowHash, actorId, createdAt: new Date() } });

    const tx = await log_action("GLOW", actionHash, actorId);

    res.status(201).json({ ok: true, hash: actionHash, tx });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /promotes
 * Body: { flowHash, actorId? }
 * - Stores an action log in Walrus with visibilityBoost=10
 * - Emits blockchain stub log_action
 */
app.post("/promotes", async (req, res, next) => {
  try {
    const { flowHash, actorId } = postPromoteSchema.parse(req.body);
    const flow = await prisma.flow.findUnique({ where: { walrusHash: flowHash } });
    if (!flow) return res.status(404).json({ ok: false, error: "Flow not found" });

    const actionObj: ActionObject = {
      kind: "action",
      action: "PROMOTE",
      flowHash,
      actorId,
      visibilityBoost: 10,
      createdAt: new Date().toISOString()
    };
    const actionHash = await storeActionObject(actionObj);

    await prisma.promote.create({
      data: { walrusHash: actionHash, flowHash, actorId, visibilityBoost: 10, createdAt: new Date() }
    });

    const tx = await log_action("PROMOTE", actionHash, actorId);

    res.status(201).json({ ok: true, hash: actionHash, tx });
  } catch (err) {
    next(err);
  }
});

/**
 * OPTIONAL
 * POST /rooms  Body: { type:"room", name }
 * POST /circles Body: { type:"circle", name }
 * POST /join    Body: { groupId, memberId }
 */
app.post("/rooms", async (req, res, next) => {
  try {
    const { type, name } = postGroupSchema.parse({ ...req.body, type: "room" });
    const created = await create_group(type, name);
    const row = await prisma.group.create({
      data: { groupId: created.chainGroupId, type, name }
    });
    res.status(201).json({ ok: true, group: row, tx: created.tx });
  } catch (err) {
    next(err);
  }
});

app.post("/circles", async (req, res, next) => {
  try {
    const { type, name } = postGroupSchema.parse({ ...req.body, type: "circle" });
    const created = await create_group(type, name);
    const row = await prisma.group.create({
      data: { groupId: created.chainGroupId, type, name }
    });
    res.status(201).json({ ok: true, group: row, tx: created.tx });
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

/** Health */
app.get("/health", (_, res) => res.json({ ok: true }));

/** Error handler */
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  const code = (err && err.status) || 500;
  res.status(code).json({ ok: false, error: err?.message ?? "Internal error" });
});

const PORT = Number(process.env.PORT || 4000);
app.listen(PORT, () => {
  console.log(`Social Hub API listening on :${PORT} (Walrus=${process.env.WALRUS_MODE}, Chain=${process.env.CHAIN_MODE})`);
});
