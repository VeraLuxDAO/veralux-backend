import { randomUUID } from "node:crypto";
import type { GroupType, WalrusHash } from "./types.js";

const MODE = process.env.CHAIN_MODE ?? "stub"; // stub | evm | sui

export type ChainTx = { txId: string; network: "stub" | "evm" | "sui" };

export async function log_action(action: "GLOW" | "PROMOTE", walrusHash: WalrusHash, actorId?: string): Promise<ChainTx> {
  if (MODE === "stub") {
    return { txId: `stub-${randomUUID()}`, network: "stub" };
  }
//   if (MODE === "evm") {
//     // TODO: call EVM contract (ethers.js):
//     // const tx = await contract.logAction(action, walrusHash, actorId ?? "0x0");
//     // await tx.wait();
//     // return { txId: tx.hash, network: "evm" };
//     throw new Error("EVM mode not yet implemented");
//   }
  if (MODE === "sui") {
    // TODO: call Sui move module function
    throw new Error("Sui mode not yet implemented");
  }
  throw new Error(`Unknown CHAIN_MODE=${MODE}`);
}

export async function create_group(type: GroupType, name: string): Promise<{ chainGroupId: string; tx: ChainTx }> {
  if (MODE === "stub") {
    return { chainGroupId: `grp_${type}_${randomUUID()}`, tx: { txId: `stub-${randomUUID()}`, network: "stub" } };
  }
  // TODO: evm/sui impl
  throw new Error("create_group not implemented for current CHAIN_MODE");
}

export async function join_group(groupId: string, memberId: string): Promise<ChainTx> {
  if (MODE === "stub") {
    return { txId: `stub-${randomUUID()}`, network: "stub" };
  }
  // TODO: evm/sui impl
  throw new Error("join_group not implemented for current CHAIN_MODE");
}
