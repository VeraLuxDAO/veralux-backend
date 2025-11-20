import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { fromBase64 } from "@mysten/sui/utils";
import type { ActionType, GroupType, WalrusHash } from "./types.js";

const MODE = process.env.CHAIN_MODE ?? "stub"; // stub | evm | sui

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

  if (MODE === "sui") {
    const client = getSuiClient();
    const keypair = getSuiKeypair();
    const packageId = getSuiPackageId();
    const moduleName = process.env.SUI_ACTION_MODULE ?? "action_log";

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
      throw new Error(`Sui transaction failed: ${result.effects?.status?.error}`);
    }

    loggedWalrusHashes.add(walrusHash);
    emitEvent({ type: "ActionLogged", action, walrusHash, actorId, at: new Date().toISOString() });
    
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
  if (MODE === "stub") {
    const id = `grp_${type}_${randomUUID()}`;
    emitEvent({ type: "GroupCreated", groupId: id, groupType: type, name, at: new Date().toISOString() });
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
    
    return { chainGroupId: groupId, tx: { txId: result.digest, network: "sui" } };
  }

  throw new Error("create_group not implemented for current CHAIN_MODE");
}

export async function join_group(groupId: string, memberId: string): Promise<ChainTx> {
  if (MODE === "stub") {
    emitEvent({ type: "GroupAction", groupId, memberId, action: "JOIN", at: new Date().toISOString() });
    return { txId: `stub-${randomUUID()}`, network: "stub" };
  }

  if (MODE === "sui") {
    const client = getSuiClient();
    const keypair = getSuiKeypair();
    const packageId = getSuiPackageId();
    const moduleName = process.env.SUI_GROUP_MODULE ?? "groups";

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
      throw new Error(`Sui join_group failed: ${result.effects?.status?.error}`);
    }

    emitEvent({ type: "GroupAction", groupId, memberId, action: "JOIN", at: new Date().toISOString() });
    
    return { txId: result.digest, network: "sui" };
  }

  throw new Error("join_group not implemented for current CHAIN_MODE");
}

/** VERIFICATION */
export async function verify_action(hash: WalrusHash): Promise<{ valid: boolean; network: ChainTx["network"] }> {
  if (MODE === "stub") {
    return { valid: loggedWalrusHashes.has(hash), network: "stub" };
  }

  if (MODE === "sui") {
    const client = getSuiClient();
    const packageId = getSuiPackageId();
    const moduleName = process.env.SUI_ACTION_MODULE ?? "action_log";
    
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
          return { valid: true, network: "sui" };
        }
      }

      return { valid: false, network: "sui" };
    } catch (error) {
      console.error("Error verifying action on Sui:", error);
      return { valid: false, network: "sui" };
    }
  }

  // TODO: For EVM, query logs/events to verify that `hash` was emitted
  throw new Error("verify_action not implemented for current CHAIN_MODE");
}
