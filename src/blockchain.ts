import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { fromBase64 } from "@mysten/sui/utils";
import type { ActionType, GroupType, WalrusHash } from "./types.js";
import { walrusIO } from "./walrus.js";
import { createLogger } from "./logger.js";

const logger = createLogger("blockchain");
const MODE = process.env.CHAIN_MODE ?? "stub"; // stub | evm | sui | walrus

/** Sui client setup (lazy initialization) */
let suiClient: SuiClient | null = null;
let suiKeypair: Ed25519Keypair | null = null;

function getSuiClient(): SuiClient {
  if (!suiClient) {
    const network = process.env.SUI_NETWORK ?? "testnet";
    const rpcUrl = process.env.SUI_RPC_URL || getFullnodeUrl(network as "testnet" | "devnet" | "mainnet");
    suiClient = new SuiClient({ url: rpcUrl });
  }
  return suiClient;
}

function getSuiKeypair(): Ed25519Keypair {
  if (!suiKeypair) {
    const privateKey = process.env.SUI_PRIVATE_KEY;
    if (!privateKey) {
      throw new Error("SUI_PRIVATE_KEY not set in environment");
    }
    
    // Support both bech32 (suiprivkey...) and base64 formats
    if (privateKey.startsWith("suiprivkey")) {
      suiKeypair = Ed25519Keypair.fromSecretKey(privateKey);
    } else {
      // Assume base64 or hex
      const secretKey = privateKey.startsWith("0x") 
        ? Buffer.from(privateKey.slice(2), "hex")
        : fromBase64(privateKey);
      suiKeypair = Ed25519Keypair.fromSecretKey(secretKey);
    }
  }
  return suiKeypair;
}

function getSuiPackageId(): string {
  const packageId = process.env.SUI_PACKAGE_ID;
  if (!packageId) {
    throw new Error("SUI_PACKAGE_ID not set. Deploy your Move package first.");
  }
  return packageId;
}

/** On-chain events we surface to the app/UI (via SSE) */
export type ChainEvent =
  | { type: "ActionLogged"; action: ActionType; walrusHash: WalrusHash; actorId?: string; at: string }
  | { type: "GroupCreated"; groupId: string; groupType: GroupType; name: string; at: string }
  | { type: "GroupAction"; groupId: string; memberId: string; action: "JOIN"; at: string };

const bus = new EventEmitter();

// Simple in-memory ledger of hashes "logged" (stub or walrus mode)
const loggedWalrusHashes = new Set<string>();

// Walrus action log chain state (only used when MODE === "walrus")
let walrusLogHead: WalrusHash | null = null;
let walrusLogSeq = 0;

type WalrusActionLogEntry = {
  kind: "actionLog";
  seq: number;
  at: string;
  action: ActionType;
  walrusHash: WalrusHash;
  actorId?: string;
  prev?: WalrusHash | null;
};

export type ChainTx = { txId: string; network: "stub" | "evm" | "sui" };

function emitEvent(e: ChainEvent) {
  process.nextTick(() => bus.emit("chain-event", e));
}

export function onChainEvent(cb: (e: ChainEvent) => void) {
  bus.on("chain-event", cb);
  return () => bus.off("chain-event", cb);
}

/** LOG */
export async function log_action(
  action: ActionType,
  walrusHash: WalrusHash,
  actorId?: string
): Promise<ChainTx> {
  logger.debug("log_action start", { mode: MODE, action, walrusHash, actorId });
  
  if (MODE === "stub") {
    loggedWalrusHashes.add(walrusHash);
    emitEvent({ type: "ActionLogged", action, walrusHash, actorId, at: new Date().toISOString() });
    const txId = `stub-${randomUUID()}`;
    logger.info("log_action (stub) complete", { txId, action });
    return { txId, network: "stub" };
  }

  if (MODE === "walrus") {
    const at = new Date().toISOString();
    const entry: WalrusActionLogEntry = {
      kind: "actionLog",
      seq: walrusLogSeq++,
      at,
      action,
      walrusHash,
      actorId,
      prev: walrusLogHead,
    };
    const { patchId: entryPatchId } = await walrusIO.putJson(entry);
    walrusLogHead = entryPatchId;
    loggedWalrusHashes.add(walrusHash);
    emitEvent({ type: "ActionLogged", action, walrusHash, actorId, at });
    logger.info("log_action (walrus) complete", { txId: entryPatchId, action, seq: entry.seq });
    return { txId: entryPatchId, network: "stub" }; // treat as stub network for now
  }

  if (MODE === "sui") {
    const client = getSuiClient();
    const keypair = getSuiKeypair();
    const packageId = getSuiPackageId();
    const moduleName = process.env.SUI_ACTION_MODULE ?? "action_log";

    logger.debug("log_action (sui) calling contract", { packageId, moduleName });
    const tx = new Transaction();
    
    // Call: package_id::action_log::log_action(action_type: u8, walrus_hash: vector<u8>, actor_id: vector<u8>)
    tx.moveCall({
      target: `${packageId}::${moduleName}::log_action`,
      arguments: [
        tx.pure.u8(actionTypeToU8(action)),
        tx.pure.string(walrusHash),
        tx.pure.string(actorId ?? ""),
      ],
    });

    const result = await client.signAndExecuteTransaction({
      transaction: tx,
      signer: keypair,
      options: { showEffects: true, showEvents: true },
    });

    if (result.effects?.status?.status !== "success") {
      logger.error("log_action (sui) failed", { error: result.effects?.status?.error });
      throw new Error(`Sui transaction failed: ${result.effects?.status?.error}`);
    }

    loggedWalrusHashes.add(walrusHash);
    emitEvent({ type: "ActionLogged", action, walrusHash, actorId, at: new Date().toISOString() });
    logger.info("log_action (sui) complete", { txId: result.digest, action });
    
    return { txId: result.digest, network: "sui" };
  }

  if (MODE === "evm") {
    // TODO: call EVM contract and emit event on receipt
    throw new Error("EVM mode not implemented yet.");
  }

  throw new Error(`Unknown CHAIN_MODE=${MODE}`);
}

// Helper: map ActionType to u8 for Move contract
function actionTypeToU8(action: ActionType): number {
  const map: Record<ActionType, number> = {
    FLOW: 0,
    GLOW: 1,
    PROMOTE: 2,
    CHAT: 3,
    GROUP_CREATE: 4,
    GROUP_JOIN: 5,
  };
  return map[action] ?? 0;
}

/** GROUPS */
export async function create_group(
  type: GroupType,
  name: string
): Promise<{ chainGroupId: string; tx: ChainTx }> {
  logger.debug("create_group start", { mode: MODE, type, name });
  
  if (MODE === "stub") {
    const id = `grp_${type}_${randomUUID()}`;
    emitEvent({ type: "GroupCreated", groupId: id, groupType: type, name, at: new Date().toISOString() });
    logger.info("create_group (stub) complete", { groupId: id, type });
    return { chainGroupId: id, tx: { txId: `stub-${randomUUID()}`, network: "stub" } };
  }

  if (MODE === "sui") {
    const client = getSuiClient();
    const keypair = getSuiKeypair();
    const packageId = getSuiPackageId();
    const moduleName = process.env.SUI_GROUP_MODULE ?? "groups";

    const tx = new Transaction();
    
    // Call: package_id::groups::create_group(group_type: u8, name: vector<u8>)
    // Returns a Group object with ID
    const groupTypeU8 = type === "room" ? 0 : 1;
    tx.moveCall({
      target: `${packageId}::${moduleName}::create_group`,
      arguments: [
        tx.pure.u8(groupTypeU8),
        tx.pure.string(name),
      ],
    });

    const result = await client.signAndExecuteTransaction({
      transaction: tx,
      signer: keypair,
      options: { showEffects: true, showEvents: true, showObjectChanges: true },
    });

    if (result.effects?.status?.status !== "success") {
      logger.error("create_group (sui) failed", { error: result.effects?.status?.error });
      throw new Error(`Sui create_group failed: ${result.effects?.status?.error}`);
    }

    // Extract the created Group object ID from object changes
    const created = result.objectChanges?.find(
      (c) => c.type === "created" && c.objectType?.includes("::groups::Group")
    );
    
    if (!created || created.type !== "created") {
      throw new Error("Failed to find created Group object in transaction result");
    }

    const groupId = created.objectId;
    emitEvent({ type: "GroupCreated", groupId, groupType: type, name, at: new Date().toISOString() });
    logger.info("create_group (sui) complete", { groupId, txId: result.digest, type });
    
    return { chainGroupId: groupId, tx: { txId: result.digest, network: "sui" } };
  }

  throw new Error("create_group not implemented for current CHAIN_MODE");
}

export async function join_group(groupId: string, memberId: string): Promise<ChainTx> {
  logger.debug("join_group start", { mode: MODE, groupId, memberId });
  
  if (MODE === "stub") {
    emitEvent({ type: "GroupAction", groupId, memberId, action: "JOIN", at: new Date().toISOString() });
    const txId = `stub-${randomUUID()}`;
    logger.info("join_group (stub) complete", { txId, groupId, memberId });
    return { txId, network: "stub" };
  }

  if (MODE === "sui") {
    const client = getSuiClient();
    const keypair = getSuiKeypair();
    const packageId = getSuiPackageId();
    const moduleName = process.env.SUI_GROUP_MODULE ?? "groups";

    logger.debug("join_group (sui) calling contract", { packageId, moduleName, groupId });
    const tx = new Transaction();
    
    // Call: package_id::groups::join_group(group: &mut Group, member_id: vector<u8>)
    tx.moveCall({
      target: `${packageId}::${moduleName}::join_group`,
      arguments: [
        tx.object(groupId), // mutable reference to Group object
        tx.pure.string(memberId),
      ],
    });

    const result = await client.signAndExecuteTransaction({
      transaction: tx,
      signer: keypair,
      options: { showEffects: true, showEvents: true },
    });

    if (result.effects?.status?.status !== "success") {
      logger.error("join_group (sui) failed", { error: result.effects?.status?.error, groupId, memberId });
      throw new Error(`Sui join_group failed: ${result.effects?.status?.error}`);
    }

    emitEvent({ type: "GroupAction", groupId, memberId, action: "JOIN", at: new Date().toISOString() });
    logger.info("join_group (sui) complete", { txId: result.digest, groupId, memberId });
    
    return { txId: result.digest, network: "sui" };
  }

  throw new Error("join_group not implemented for current CHAIN_MODE");
}

/** VERIFICATION */
export async function verify_action(hash: WalrusHash): Promise<{ valid: boolean; network: ChainTx["network"] }> {
  logger.debug("verify_action start", { mode: MODE, hash });
  
  if (MODE === "stub") {
    const valid = loggedWalrusHashes.has(hash);
    logger.info("verify_action (stub) complete", { hash, valid });
    return { valid, network: "stub" };
  }

  if (MODE === "walrus") {
    // Walk the walrus action log chain starting from head until we either find the hash or exhaust
    logger.debug("verify_action (walrus) walking chain", { head: walrusLogHead });
    let current = walrusLogHead;
    const visited = new Set<string>();
    while (current && !visited.has(current)) {
      visited.add(current);
      try {
        const entry = await walrusIO.getJson<WalrusActionLogEntry>(current);
        if (entry.walrusHash === hash) {
          logger.info("verify_action (walrus) found", { hash, entryHash: current });
          return { valid: true, network: "stub" };
        }
        current = entry.prev || null;
      } catch (err) {
        logger.warn("verify_action (walrus) chain read error", { current, error: err instanceof Error ? err.message : String(err) });
        break; // corrupted chain segment; treat as not found
      }
    }
    logger.info("verify_action (walrus) not found", { hash, chainLength: visited.size });
    return { valid: false, network: "stub" };
  }

  if (MODE === "sui") {
    const client = getSuiClient();
    const packageId = getSuiPackageId();
    const moduleName = process.env.SUI_ACTION_MODULE ?? "action_log";
    
    logger.debug("verify_action (sui) querying events", { packageId, moduleName });
    
    // Query events emitted by log_action for this hash
    // Event structure: package_id::action_log::ActionLogged { walrus_hash: vector<u8>, ... }
    try {
      const events = await client.queryEvents({
        query: {
          MoveEventType: `${packageId}::${moduleName}::ActionLogged`,
        },
        limit: 50, // check recent events
        order: "descending",
      });

      // Check if any event contains our hash
      for (const event of events.data) {
        const eventData = event.parsedJson as any;
        if (eventData?.walrus_hash === hash) {
          logger.info("verify_action (sui) found", { hash });
          return { valid: true, network: "sui" };
        }
      }

      logger.info("verify_action (sui) not found", { hash, eventsChecked: events.data.length });
      return { valid: false, network: "sui" };
    } catch (error) {
      logger.error("verify_action (sui) error", { hash, error: error instanceof Error ? error.message : String(error) });
      return { valid: false, network: "sui" };
    }
  }

  // TODO: For EVM, query logs/events to verify that `hash` was emitted
  throw new Error("verify_action not implemented for current CHAIN_MODE");
}
