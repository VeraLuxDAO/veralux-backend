import "dotenv/config";
import express from "express";
import cors from "cors";
import multer from "multer";
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

const prisma = new PrismaClient();
const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB

app.use(cors());
app.use(express.json({ limit: "2mb" }));

/* ------------------------------ SSE: /events ------------------------------ */
type SSEClient = { id: number; res: express.Response };
const clients = new Map<number, SSEClient>();
let nextClientId = 1;

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
 * POST /flows
 * - JSON {text} OR multipart("image") + optional caption
 * - Stores in Walrus; logs FLOW to chain; indexes minimal metadata
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

/** GET /flows?limit=20&cursor=ISO — newest first, hydrated from Walrus */
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
