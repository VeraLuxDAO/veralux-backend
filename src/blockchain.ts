import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type { ActionType, GroupType, WalrusHash } from "./types.js";

const MODE = process.env.CHAIN_MODE ?? "stub"; // stub | evm | sui

/** On-chain events we surface to the app/UI (via SSE) */
export type ChainEvent =
  | { type: "ActionLogged"; action: ActionType; walrusHash: WalrusHash; actorId?: string; at: string }
  | { type: "GroupCreated"; groupId: string; groupType: GroupType; name: string; at: string }
  | { type: "GroupAction"; groupId: string; memberId: string; action: "JOIN"; at: string };

const bus = new EventEmitter();

// Simple in-memory ledger of hashes "logged" on chain (stub mode)
const loggedWalrusHashes = new Set<string>();

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
  if (MODE === "stub") {
    loggedWalrusHashes.add(walrusHash);
    emitEvent({ type: "ActionLogged", action, walrusHash, actorId, at: new Date().toISOString() });
    return { txId: `stub-${randomUUID()}`, network: "stub" };
  }

  if (MODE === "evm") {
    // TODO: call EVM contract and emit event on receipt
    throw new Error("EVM mode not implemented yet.");
  }

  if (MODE === "sui") {
    // TODO: call Sui Move module and emit event on receipt
    throw new Error("Sui mode not implemented yet.");
  }

  throw new Error(`Unknown CHAIN_MODE=${MODE}`);
}

/** GROUPS */
export async function create_group(
  type: GroupType,
  name: string
): Promise<{ chainGroupId: string; tx: ChainTx }> {
  if (MODE === "stub") {
    const id = `grp_${type}_${randomUUID()}`;
    emitEvent({ type: "GroupCreated", groupId: id, groupType: type, name, at: new Date().toISOString() });
    return { chainGroupId: id, tx: { txId: `stub-${randomUUID()}`, network: "stub" } };
  }
  throw new Error("create_group not implemented for current CHAIN_MODE");
}

export async function join_group(groupId: string, memberId: string): Promise<ChainTx> {
  if (MODE === "stub") {
    emitEvent({ type: "GroupAction", groupId, memberId, action: "JOIN", at: new Date().toISOString() });
    return { txId: `stub-${randomUUID()}`, network: "stub" };
  }
  throw new Error("join_group not implemented for current CHAIN_MODE");
}

/** VERIFICATION */
export async function verify_action(hash: WalrusHash): Promise<{ valid: boolean; network: ChainTx["network"] }> {
  if (MODE === "stub") {
    return { valid: loggedWalrusHashes.has(hash), network: "stub" };
  }
  // TODO: For EVM/Sui, query logs/events to verify that `hash` was emitted
  throw new Error("verify_action not implemented for current CHAIN_MODE");
}
