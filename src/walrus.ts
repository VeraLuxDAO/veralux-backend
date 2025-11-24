import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { walrus as walrusExtension, WalrusClient } from "@mysten/walrus";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { getFullnodeUrl } from "@mysten/sui/client";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { fromBase64 } from "@mysten/sui/utils";
import type { ActionObject, ChatObject, FlowObject, GroupMetaObject, WalrusHash } from "./types.js";
import { createLogger } from "./logger.js";

const logger = createLogger("walrus");

const MODE = process.env.WALRUS_MODE ?? "mock"; // mock | real
const DATA_DIR = path.resolve(process.cwd(), "data", "walrus");
const WALRUS_EPOCHS = Number(process.env.WALRUS_EPOCHS ?? 3) || 3;
const WALRUS_DELETABLE = (process.env.WALRUS_DELETABLE ?? "true").toLowerCase() !== "false";
const WALRUS_UPLOAD_RELAY_HOST = process.env.WALRUS_UPLOAD_RELAY_HOST;
const WALRUS_UPLOAD_TIP_MAX_ENV = process.env.WALRUS_UPLOAD_TIP_MAX;
const WALRUS_UPLOAD_TIP_MAX =
  WALRUS_UPLOAD_TIP_MAX_ENV && Number.isFinite(Number(WALRUS_UPLOAD_TIP_MAX_ENV))
    ? Number(WALRUS_UPLOAD_TIP_MAX_ENV)
    : undefined;
const WALRUS_STORAGE_TIMEOUT_MS = Number(process.env.WALRUS_STORAGE_TIMEOUT_MS ?? 60_000);
const WALRUS_WASM_URL = process.env.WALRUS_WASM_URL;
const WALRUS_NETWORK_ENV = (process.env.WALRUS_NETWORK ?? process.env.SUI_NETWORK ?? "testnet").toLowerCase();
const WALRUS_NETWORK: "testnet" | "mainnet" = WALRUS_NETWORK_ENV === "mainnet" ? "mainnet" : "testnet";

let cachedSuiClient: SuiJsonRpcClient | null = null;
let cachedWalrusClient: WalrusClient | null = null;
let cachedKeypair: Ed25519Keypair | null = null;

async function ensureDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}
function sha256(buffer: Buffer): WalrusHash {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

export type WalrusUploadMetadata = {
  identifier?: string;
  mime?: string;
  tags?: Record<string, string>;
};

export interface IWalrus {
  putRaw(buffer: Buffer, metadata?: WalrusUploadMetadata): Promise<WalrusHash>;
  getRaw(hash: WalrusHash): Promise<Buffer>;
  putJson<T extends object>(obj: T, metadata?: WalrusUploadMetadata): Promise<WalrusHash>;
  getJson<T = unknown>(hash: WalrusHash): Promise<T>;
}

class MockWalrus implements IWalrus {
  async putRaw(buffer: Buffer, metadata?: WalrusUploadMetadata): Promise<WalrusHash> {
    logger.debug("MockWalrus.putRaw start", { size: buffer.length, metadata });
    await ensureDir();
    const hash = sha256(buffer);
    await fs.writeFile(path.join(DATA_DIR, hash), buffer);
    logger.info("MockWalrus.putRaw success", { hash, size: buffer.length });
    return hash;
  }
  async getRaw(hash: WalrusHash): Promise<Buffer> {
    logger.debug("MockWalrus.getRaw start", { hash });
    const buffer = await fs.readFile(path.join(DATA_DIR, hash));
    logger.debug("MockWalrus.getRaw success", { hash, size: buffer.length });
    return buffer;
  }
  async putJson<T extends object>(obj: T, metadata?: WalrusUploadMetadata): Promise<WalrusHash> {
    logger.debug("MockWalrus.putJson start", { metadata });
    const buf = Buffer.from(JSON.stringify(obj));
    return this.putRaw(buf, metadata);
  }
  async getJson<T = unknown>(hash: WalrusHash): Promise<T> {
    logger.debug("MockWalrus.getJson start", { hash });
    const buf = await this.getRaw(hash);
    const result = JSON.parse(buf.toString("utf8")) as T;
    logger.debug("MockWalrus.getJson success", { hash });
    return result;
  }
}

class SdkWalrus implements IWalrus {
  private readonly suiClient = getSdkSuiClient();
  private readonly client = getSdkWalrusClient();
  private readonly signer = getWalrusKeypair();
  private readonly owner = getWalrusOwnerAddress();

  async putRaw(buffer: Buffer, metadata?: WalrusUploadMetadata): Promise<WalrusHash> {
    logger.debug("SdkWalrus.putRaw start", { size: buffer.length, metadata });
    const result = await this.writeBlob(buffer, metadata);
    logger.info("SdkWalrus.putRaw success", { blobId: result, size: buffer.length });
    return result;
  }

  async getRaw(hash: WalrusHash): Promise<Buffer> {
    logger.debug("SdkWalrus.getRaw start", { blobId: hash });
    const bytes = await this.client.readBlob({ blobId: hash });
    logger.info("SdkWalrus.getRaw success", { blobId: hash, size: bytes.length });
    return Buffer.from(bytes);
  }

  async putJson<T extends object>(obj: T, metadata?: WalrusUploadMetadata): Promise<WalrusHash> {
    const buf = Buffer.from(JSON.stringify(obj));
    const enriched: WalrusUploadMetadata = {
      mime: "application/json",
      identifier: metadata?.identifier,
      tags: metadata?.tags,
    };
    return this.writeBlob(buf, enriched);
  }

  async getJson<T = unknown>(hash: WalrusHash): Promise<T> {
    const buf = await this.getRaw(hash);
    return JSON.parse(buf.toString("utf8")) as T;
  }

  private async writeBlob(buffer: Buffer, _metadata?: WalrusUploadMetadata): Promise<WalrusHash> {
    logger.info("writeBlob start", { size: buffer.length, epochs: WALRUS_EPOCHS, deletable: WALRUS_DELETABLE });
    const bytes = new Uint8Array(buffer);
    const flow = this.client.writeBlobFlow({ blob: bytes });
    
    logger.debug("writeBlob encoding...");
    await flow.encode();
    logger.debug("writeBlob encoded");

    logger.debug("writeBlob registering...", { owner: this.owner });
    const registerTx = flow.register({
      epochs: WALRUS_EPOCHS,
      owner: this.owner,
      deletable: WALRUS_DELETABLE,
    });

    const registerResult = await this.suiClient.signAndExecuteTransaction({
      transaction: registerTx,
      signer: this.signer,
      options: { showEffects: true, showObjectChanges: true },
    });
    
    if (registerResult.effects?.status?.status !== "success") {
      logger.error("writeBlob register failed", { 
        error: registerResult.effects?.status?.error 
      });
      throw new Error(`Registration transaction failed: ${registerResult.effects?.status?.error}`);
    }
    
    logger.info("writeBlob registered", { digest: registerResult.digest });

    logger.debug("writeBlob uploading...", { digest: registerResult.digest });
    try {
      // Pass the transaction digest to upload for relay verification
      await flow.upload({ 
        digest: registerResult.digest 
      });
      logger.info("writeBlob uploaded successfully");
    } catch (err) {
      logger.error("writeBlob upload failed", { 
        error: err instanceof Error ? err.message : String(err),
        digest: registerResult.digest 
      });
      throw err;
    }

    logger.debug("writeBlob certifying...");
    const certifyTx = flow.certify();
    await this.suiClient.signAndExecuteTransaction({
      transaction: certifyTx,
      signer: this.signer,
      options: { showEffects: true },
    });
    logger.info("writeBlob certified");

    const { blobId } = await flow.getBlob();
    logger.info("writeBlob complete", { blobId });
    return blobId;
  }
}

logger.info("Initializing Walrus implementation", { mode: MODE });
let walrusInstance: IWalrus;
try {
  walrusInstance = MODE === "real" ? new SdkWalrus() : new MockWalrus();
  logger.info("Walrus implementation initialized successfully", { mode: MODE });
} catch (err) {
  logger.error("Failed to initialize Walrus implementation", { 
    mode: MODE, 
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined
  });
  throw err;
}
export const walrus: IWalrus = walrusInstance;

const jsonMeta = (prefix: string): WalrusUploadMetadata => ({
  identifier: `${prefix}-${Date.now()}.json`,
  mime: "application/json",
});

// high-level helpers
export const storeFlowObject = (obj: FlowObject) => walrus.putJson(obj, jsonMeta("flow"));
export const loadFlowObject = (hash: WalrusHash) => walrus.getJson<FlowObject>(hash);

export const storeActionObject = (obj: ActionObject) => walrus.putJson(obj, jsonMeta("action"));
export const storeChatObject = (obj: ChatObject) => walrus.putJson(obj, jsonMeta("chat"));
export const storeGroupMeta = (obj: GroupMetaObject) => walrus.putJson(obj, jsonMeta("group"));
export const storeText = (text: string, identifier?: string) =>
  walrus.putRaw(Buffer.from(text, "utf8"), {
    identifier: identifier ?? `text-${Date.now()}.txt`,
    mime: "text/plain",
  });

function getSdkSuiClient(): SuiJsonRpcClient {
  if (!cachedSuiClient) {
    const network = (process.env.SUI_NETWORK ?? "testnet") as "localnet" | "devnet" | "testnet" | "mainnet";
    const rpcUrl = process.env.SUI_RPC_URL || getFullnodeUrl(network);
    logger.debug("Initializing SuiJsonRpcClient", { network, rpcUrl });
    try {
      cachedSuiClient = new SuiJsonRpcClient({ url: rpcUrl, network });
      logger.info("SuiJsonRpcClient initialized successfully", { network });
    } catch (err) {
      logger.error("Failed to initialize SuiJsonRpcClient", { error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  }
  return cachedSuiClient;
}

function getSdkWalrusClient(): WalrusClient {
  if (!cachedWalrusClient) {
    logger.debug("Initializing Walrus extension", { network: WALRUS_NETWORK });
    const suiClient = getSdkSuiClient();
    const options = walrusExtension({
      network: WALRUS_NETWORK,
      wasmUrl: WALRUS_WASM_URL,
      storageNodeClientOptions: {
        timeout: WALRUS_STORAGE_TIMEOUT_MS,
        onError: (error) => {
          const message = error instanceof Error ? error.message : String(error);
          logger.warn("Walrus storage node error", { message });
        },
      },
      uploadRelay: WALRUS_UPLOAD_RELAY_HOST
        ? {
            host: WALRUS_UPLOAD_RELAY_HOST,
            sendTip:
              WALRUS_UPLOAD_TIP_MAX !== undefined
                ? { max: WALRUS_UPLOAD_TIP_MAX }
                : undefined,
          }
        : undefined,
    });

    try {
      const extended = suiClient.$extend(options);
      cachedWalrusClient = extended.walrus;
      logger.info("Walrus client initialized via extension", { network: WALRUS_NETWORK });
    } catch (err) {
      logger.error("Failed to initialize Walrus extension", { error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  }
  return cachedWalrusClient;
}

function getWalrusKeypair(): Ed25519Keypair {
  if (!cachedKeypair) {
    logger.debug("Initializing Walrus keypair");
    const privateKey = process.env.WALRUS_PRIVATE_KEY || process.env.SUI_PRIVATE_KEY;
    if (!privateKey) {
      logger.error("Missing private key environment variable");
      throw new Error("Set WALRUS_PRIVATE_KEY or SUI_PRIVATE_KEY to use WALRUS_MODE=real");
    }

    try {
      if (privateKey.startsWith("suiprivkey")) {
        cachedKeypair = Ed25519Keypair.fromSecretKey(privateKey);
      } else {
        const secretKey = privateKey.startsWith("0x")
          ? Buffer.from(privateKey.slice(2), "hex")
          : fromBase64(privateKey);
        cachedKeypair = Ed25519Keypair.fromSecretKey(secretKey);
      }
      logger.info("Walrus keypair initialized", { address: cachedKeypair.toSuiAddress() });
    } catch (err) {
      logger.error("Failed to initialize keypair", { error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  }
  return cachedKeypair;
}

function getWalrusOwnerAddress(): string {
  return process.env.WALRUS_OWNER_ADDRESS || getWalrusKeypair().toSuiAddress();
}
