import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { walrus, WalrusFile } from "@mysten/walrus";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { getFullnodeUrl } from "@mysten/sui/client";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { fromBase64 } from "@mysten/sui/utils";
import type { ActionObject, ChatObject, FlowObject, GroupMetaObject, WalrusPatchId } from "./types.js";
import { createLogger } from "./logger.js";

/**
 * Walrus Integration Module
 * ========================
 * This module implements the recommended patterns from the Walrus guide:
 * - Use WalrusFile.from() for file creation (modern abstraction)
 * - Use writeFiles/writeFilesFlow for uploading (supports quilts for batching)
 * - Use getFiles for efficient batch reads
 * - Use getBlob for accessing quilt contents with filtering
 * - Use storageCost for cost estimation
 * 
 * Key patterns:
 * - Single files: writeFiles with one WalrusFile
 * - Batched data (comments, likes, messages): writeFiles with multiple WalrusFiles → single quilt
 * - Reads: getFiles for individual files, getBlob().files() for quilt contents
 */

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

// Aggregator URLs for fast HTTP-based reads
const WALRUS_AGGREGATOR_URL = process.env.WALRUS_AGGREGATOR_URL ?? 
  (WALRUS_NETWORK === "mainnet" 
    ? "https://aggregator.walrus.network" 
    : "https://wal-aggregator-testnet.staketab.org");

let cachedSuiClient: SuiJsonRpcClient | null = null;
let cachedWalrusClient: any | null = null;
let cachedKeypair: Ed25519Keypair | null = null;

async function ensureDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}
function sha256(buffer: Buffer): WalrusPatchId {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

export type WalrusUploadMetadata = {
  identifier?: string;
  mime?: string;
  tags?: Record<string, string>;
};

/** Result from uploading a single file */
export type UploadResult = {
  blobId: string;   // The quilt/blob container ID
  patchId: string;  // The specific file ID (use this to fetch!)
};

/** Result from a single file upload */
export type WriteFileResult = {
  id: string;      // QuiltPatchId for the specific file
  blobId: string;  // Parent blob/quilt ID
};

/** Result from a batched file upload (quilt) */
export type WriteFilesResult = WriteFileResult[];

export interface IWalrus {
  // Core operations - return BOTH blobId and patchId
  putRaw(buffer: Buffer, metadata?: WalrusUploadMetadata): Promise<UploadResult>;
  getRaw(patchId: WalrusPatchId): Promise<Buffer>;
  putJson<T extends object>(obj: T, metadata?: WalrusUploadMetadata): Promise<UploadResult>;
  getJson<T = unknown>(patchId: WalrusPatchId): Promise<T>;
  getManyJson<T = unknown>(patchIds: WalrusPatchId[]): Promise<Record<WalrusPatchId, T>>;
  // Flexible read that auto-detects JSON / text / binary
  readFlexible(patchId: WalrusPatchId): Promise<{ kind: "json" | "text" | "binary"; data: any; bytes: Uint8Array }>;
  // Get raw file from quilt (extracts first file if it's a quilt blob)
  getRawFromQuiltOrPatch(patchId: WalrusPatchId): Promise<Buffer>;
  // Read by patch ID - returns data and identifier (filename)
  readByPatchId(patchId: string): Promise<{ data: Buffer; identifier: string; isImage: boolean; isJson: boolean }>;
  
  // FASTEST: Fetch via aggregator URL (HTTP fetch, ~100-300ms)
  fetchByPatchId(patchId: string): Promise<{ data: Buffer; identifier: string; contentType: string }>;
  
  // Advanced: batch writes using quilts (cost-efficient for multiple small files)
  writeFiles(files: Array<{ contents: Uint8Array; identifier: string; tags?: Record<string, string> }>): Promise<WriteFilesResult>;
  
  // Advanced: read from a quilt by blobId with optional filtering
  readFromQuilt(blobId: string, filters?: { identifiers?: string[]; tags?: Record<string, string>[] }): Promise<Array<{ identifier: string; data: Uint8Array }>>;
  
  // Cost estimation
  estimateCost(sizeBytes: number, epochs?: number): Promise<{ storageCost: bigint; writeCost: bigint; totalCost: bigint }>;
  
  // Certification: certify an uncertified blob (for fixing orphaned blobs)
  certifyBlob(blobId: string, blobObjectId: string): Promise<string>;
}

class MockWalrus implements IWalrus {
  async putRaw(buffer: Buffer, metadata?: WalrusUploadMetadata): Promise<UploadResult> {
    logger.debug("MockWalrus.putRaw start", { size: buffer.length, metadata });
    await ensureDir();
    const patchId = sha256(buffer);
    await fs.writeFile(path.join(DATA_DIR, patchId), buffer);
    logger.info("MockWalrus.putRaw success", { patchId, size: buffer.length });
    // In mock mode, blobId and patchId are the same (no real quilt structure)
    return { blobId: patchId, patchId };
  }
  async getRaw(patchId: WalrusPatchId): Promise<Buffer> {
    logger.debug("MockWalrus.getRaw start", { patchId });
    const buffer = await fs.readFile(path.join(DATA_DIR, patchId));
    logger.debug("MockWalrus.getRaw success", { patchId, size: buffer.length });
    return buffer;
  }
  async putJson<T extends object>(obj: T, metadata?: WalrusUploadMetadata): Promise<UploadResult> {
    logger.debug("MockWalrus.putJson start", { metadata });
    const buf = Buffer.from(JSON.stringify(obj));
    return this.putRaw(buf, metadata);
  }
  async getJson<T = unknown>(patchId: WalrusPatchId): Promise<T> {
    logger.debug("MockWalrus.getJson start", { patchId });
    const buf = await this.getRaw(patchId);
    const result = JSON.parse(buf.toString("utf8")) as T;
    logger.debug("MockWalrus.getJson success", { patchId });
    return result;
  }
  async getManyJson<T = unknown>(patchIds: WalrusPatchId[]): Promise<Record<WalrusPatchId, T>> {
    const out: Record<string, T> = {};
    for (const h of patchIds) {
      try {
        out[h] = await this.getJson<T>(h);
      } catch (err) {
        logger.warn("MockWalrus.getManyJson failed entry", { patchId: h, error: err instanceof Error ? err.message : String(err) });
      }
    }
    return out;
  }
  async readFlexible(patchId: WalrusPatchId): Promise<{ kind: "json" | "text" | "binary"; data: any; bytes: Uint8Array }> {
    const buf = await this.getRaw(patchId);
    const bytes = new Uint8Array(buf);
    const text = buf.toString("utf8");
    const trimmed = text.trimStart();
    // Try JSON first if it looks like JSON
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        const data = JSON.parse(text);
        return { kind: "json", data, bytes };
      } catch { /* fall through */ }
    }
    // Heuristic: printable ASCII ratio
    let printable = 0;
    const sampleLimit = Math.min(bytes.length, 256);
    for (let i = 0; i < sampleLimit; i++) {
      const b = bytes[i];
      if (b === 9 || b === 10 || b === 13 || (b >= 32 && b <= 126)) printable++;
    }
    const ratio = sampleLimit ? printable / sampleLimit : 0;
    if (ratio > 0.85) {
      return { kind: "text", data: text, bytes };
    }
    return { kind: "binary", data: bytes, bytes };
  }

  async getRawFromQuiltOrPatch(patchId: WalrusPatchId): Promise<Buffer> {
    logger.debug("MockWalrus.getRawFromQuiltOrPatch", { patchId });
    // In mock mode, quilts aren't a thing - just read directly
    return this.getRaw(patchId);
  }

  async readByPatchId(patchId: string): Promise<{ data: Buffer; identifier: string; isImage: boolean; isJson: boolean }> {
    // Mock: just read directly, use patchId as identifier
    const data = await this.getRaw(patchId);
    const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(patchId);
    const isJson = /\.json$/i.test(patchId);
    return { data, identifier: patchId, isImage, isJson };
  }

  async fetchByPatchId(patchId: string): Promise<{ data: Buffer; identifier: string; contentType: string }> {
    // Mock: just read directly
    const data = await this.getRaw(patchId);
    return { data, identifier: patchId, contentType: "application/octet-stream" };
  }
  
  async writeFiles(files: Array<{ contents: Uint8Array; identifier: string; tags?: Record<string, string> }>): Promise<WriteFilesResult> {
    logger.debug("MockWalrus.writeFiles start", { count: files.length });
    const results: WriteFilesResult = [];
    // In mock mode, we simulate a quilt by storing each file separately
    // All files share the same "blobId" (first file's hash as quilt ID)
    let quiltId: string | null = null;
    for (const file of files) {
      const buf = Buffer.from(file.contents);
      const { patchId } = await this.putRaw(buf, { identifier: file.identifier, tags: file.tags });
      if (!quiltId) quiltId = patchId;
      results.push({ id: patchId, blobId: quiltId });
    }
    logger.info("MockWalrus.writeFiles success", { count: files.length, quiltId });
    return results;
  }
  
  async readFromQuilt(blobId: string, _filters?: { identifiers?: string[]; tags?: Record<string, string>[] }): Promise<Array<{ identifier: string; data: Uint8Array }>> {
    logger.debug("MockWalrus.readFromQuilt start", { blobId });
    // In mock mode, blobId IS the hash of a single file
    // For real quilts, we would query the blob and filter
    try {
      const buf = await this.getRaw(blobId);
      return [{ identifier: blobId, data: new Uint8Array(buf) }];
    } catch {
      logger.warn("MockWalrus.readFromQuilt not found", { blobId });
      return [];
    }
  }
  
  async estimateCost(_sizeBytes: number, _epochs?: number): Promise<{ storageCost: bigint; writeCost: bigint; totalCost: bigint }> {
    // Mock returns zero cost
    return { storageCost: 0n, writeCost: 0n, totalCost: 0n };
  }
  
  async certifyBlob(blobId: string, _blobObjectId: string): Promise<string> {
    // Mock mode: blobs are always "certified"
    logger.debug("MockWalrus.certifyBlob (no-op)", { blobId });
    return blobId;
  }
}

class SdkWalrus implements IWalrus {
  private readonly suiClient = getSdkSuiClient();
  private readonly walrusClient = getSdkWalrusClient();
  private readonly signer = getWalrusKeypair();
  private readonly owner = getWalrusOwnerAddress();

  /**
   * Store raw binary data using writeFilesFlow with explicit certification
   * This ensures the blob is fully certified before returning
   * Returns BOTH blobId (quilt container) and patchId (file identifier)
   */
  async putRaw(buffer: Buffer, metadata?: WalrusUploadMetadata): Promise<UploadResult> {
    logger.debug("SdkWalrus.putRaw start", { size: buffer.length, metadata });
    
    // Use WalrusFile.from() as recommended by the guide
    const file = WalrusFile.from({
      contents: new Uint8Array(buffer),
      identifier: metadata?.identifier ?? `file-${Date.now()}`,
      tags: {
        ...(metadata?.mime ? { "content-type": metadata.mime } : {}),
        ...(metadata?.tags ?? {}),
      },
    });

    // Use writeFilesFlow for explicit control over certification
    const result = await this.writeFilesWithCertification([file]);
    
    logger.info("SdkWalrus.putRaw success", { 
      blobId: result.blobId, 
      patchId: result.patchId,
      size: buffer.length 
    });
    return { blobId: result.blobId, patchId: result.patchId };
  }

  /**
   * Read raw data using getFiles first (handles quilts), then readBlob fallback
   */
  async getRaw(patchId: WalrusPatchId): Promise<Buffer> {
    logger.debug("SdkWalrus.getRaw start", { patchId });
    
    // Strategy 1: Try getFiles first (automatically decodes quilts)
    try {
      const [file] = await this.walrusClient.walrus.getFiles({ ids: [patchId] });
      if (file) {
        const bytes = await file.bytes();
        logger.info("SdkWalrus.getRaw success via getFiles", { patchId, size: bytes.length });
        return Buffer.from(bytes);
      }
    } catch (err) {
      logger.debug("SdkWalrus.getRaw getFiles failed, trying readBlob", { 
        patchId, 
        error: err instanceof Error ? err.message : String(err) 
      });
    }
    
    // Strategy 2: Fallback to readBlob (for non-quilt blobs)
    try {
      const bytes = await this.walrusClient.walrus.readBlob({ blobId: patchId });
      logger.info("SdkWalrus.getRaw success via readBlob", { patchId, size: bytes.length });
      return Buffer.from(bytes);
    } catch (err) {
      logger.error("SdkWalrus.getRaw failed", { 
        patchId, 
        error: err instanceof Error ? err.message : String(err) 
      });
    }
    
    throw new Error(`Walrus file not found for id ${patchId}`);
  }

  /**
   * Store JSON data with application/json content-type
   * Returns BOTH blobId (quilt container) and patchId (file identifier)
   */
  async putJson<T extends object>(obj: T, metadata?: WalrusUploadMetadata): Promise<UploadResult> {
    const jsonBytes = new TextEncoder().encode(JSON.stringify(obj));
    const enriched: WalrusUploadMetadata = {
      identifier: metadata?.identifier ?? `json-${Date.now()}.json`,
      mime: "application/json",
      tags: metadata?.tags,
    };
    
    const file = WalrusFile.from({
      contents: jsonBytes,
      identifier: enriched.identifier!,
      tags: {
        "content-type": "application/json",
        ...(enriched.tags ?? {}),
      },
    });

    const result = await this.writeFilesWithCertification([file]);
    
    logger.info("SdkWalrus.putJson success", { 
      blobId: result.blobId, 
      patchId: result.patchId 
    });
    return { blobId: result.blobId, patchId: result.patchId };
  }

  /**
   * Read JSON using multiple strategies:
   * 1. readBlob (direct blob read)
   * 2. getFiles (works for quilt patch IDs)
   */
  async getJson<T = unknown>(patchId: WalrusPatchId): Promise<T> {
    logger.debug("SdkWalrus.getJson start", { patchId });
    
    // Strategy 1: Try readBlob directly (fastest for simple blobs)
    try {
      const bytes = await this.walrusClient.walrus.readBlob({ blobId: patchId });
      const text = new TextDecoder().decode(bytes);
      const json = JSON.parse(text);
      logger.debug("SdkWalrus.getJson success via readBlob", { patchId });
      return json as T;
    } catch (err) {
      logger.debug("SdkWalrus.getJson readBlob failed, trying getFiles", { 
        patchId, 
        error: err instanceof Error ? err.message : String(err) 
      });
    }

    // Strategy 2: Try getFiles (works for quilt patch IDs)
    try {
      const [file] = await this.walrusClient.walrus.getFiles({ ids: [patchId] });
      if (file) {
        const json = await file.json();
        logger.debug("SdkWalrus.getJson success via getFiles", { patchId });
        return json as T;
      }
    } catch (err) {
      logger.error("SdkWalrus.getJson failed", { 
        patchId, 
        error: err instanceof Error ? err.message : String(err) 
      });
    }
    
    throw new Error(`Failed to read JSON from Walrus: ${patchId}`);
  }

  /**
   * Batch read multiple JSON files efficiently
   * Uses readBlob for each hash (most reliable), skips binary/non-JSON blobs
   */
  async getManyJson<T = unknown>(patchIds: WalrusPatchId[]): Promise<Record<WalrusPatchId, T>> {
    logger.debug("SdkWalrus.getManyJson start", { count: patchIds.length });
    if (patchIds.length === 0) return {} as Record<WalrusPatchId, T>;
    
    const out: Record<WalrusPatchId, T> = {} as Record<WalrusPatchId, T>;
    
    // Read each blob individually using readBlob (most reliable)
    for (const h of patchIds) {
      try {
        const bytes = await this.walrusClient.walrus.readBlob({ blobId: h });
        
        // Check if this looks like JSON (starts with { or [)
        if (bytes.length > 0 && (bytes[0] === 0x7B || bytes[0] === 0x5B)) {
          const text = new TextDecoder().decode(bytes);
          out[h] = JSON.parse(text) as T;
        } else {
          // This is binary data (image, etc.) - skip it
          logger.debug("SdkWalrus.getManyJson skipping binary blob", { 
            patchId: h, 
            firstByte: bytes[0]?.toString(16),
            size: bytes.length 
          });
        }
      } catch (readErr) {
        // Fallback: try getFiles (for quilt patch IDs)
        try {
          const [file] = await this.walrusClient.walrus.getFiles({ ids: [h] });
          if (file) {
            const bytes = await file.bytes();
            if (bytes.length > 0 && (bytes[0] === 0x7B || bytes[0] === 0x5B)) {
              const text = new TextDecoder().decode(bytes);
              out[h] = JSON.parse(text) as T;
            } else {
              logger.debug("SdkWalrus.getManyJson skipping binary (getFiles)", { patchId: h });
            }
          }
        } catch (filesErr) {
          logger.warn("SdkWalrus.getManyJson read failed", { 
            patchId: h, 
            readError: readErr instanceof Error ? readErr.message : String(readErr),
            filesError: filesErr instanceof Error ? filesErr.message : String(filesErr)
          });
        }
      }
    }
    
    logger.debug("SdkWalrus.getManyJson complete", { 
      requested: patchIds.length, 
      loaded: Object.keys(out).length 
    });
    return out;
  }

  /**
   * Unified flexible reader: attempts JSON, then text, else binary.
   * Uses getFiles first (supports both quilts & standalone blobs) then readBlob fallback.
   */
  async readFlexible(patchId: WalrusPatchId): Promise<{ kind: "json" | "text" | "binary"; data: any; bytes: Uint8Array }> {
    logger.debug("SdkWalrus.readFlexible start", { patchId });
    let fileBytes: Uint8Array | undefined;
    // Preferred: getFiles (supports patch IDs & quilts)
    try {
      const [file] = await this.walrusClient.walrus.getFiles({ ids: [patchId] });
      if (file) {
        const b = await file.bytes();
        fileBytes = b;
        logger.debug("SdkWalrus.readFlexible loaded via getFiles", { patchId, size: b.length });
      }
    } catch (err) {
      logger.debug("SdkWalrus.readFlexible getFiles failed", { patchId, error: err instanceof Error ? err.message : String(err) });
    }
    // Fallback to readBlob if getFiles produced nothing
    if (!fileBytes) {
      try {
        const blobBytes = await this.walrusClient.walrus.readBlob({ blobId: patchId });
        fileBytes = blobBytes;
        logger.debug("SdkWalrus.readFlexible loaded via readBlob", { patchId, size: blobBytes.length });
      } catch (err) {
        logger.error("SdkWalrus.readFlexible failed to load bytes", { patchId, error: err instanceof Error ? err.message : String(err) });
        throw new Error(`Walrus blob not found: ${patchId}`);
      }
    }
    const bytes = fileBytes!; // guaranteed defined here

    // Quick signature checks for common binary formats to avoid misclassifying as text
    const isImageSignature = (() => {
      if (bytes.length >= 4) {
        // PNG 89 50 4E 47
        if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return true;
        // JPG FF D8 FF
        if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return true;
        // GIF 47 49 46 38
        if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return true;
        // WEBP RIFF....WEBP (we only check RIFF header)
        if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) return true;
      }
      return false;
    })();
    if (isImageSignature) {
      return { kind: "binary", data: bytes, bytes };
    }

    // Attempt textual decode
    let asText: string | undefined;
    try {
      asText = new TextDecoder().decode(bytes);
    } catch {
      return { kind: "binary", data: bytes, bytes };
    }
    if (asText) {
      const trimmed = asText.trimStart();
      if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        try {
          const json = JSON.parse(asText);
          return { kind: "json", data: json, bytes };
        } catch (err) {
          logger.debug("SdkWalrus.readFlexible JSON parse failed", { blobId: patchId, error: err instanceof Error ? err.message : String(err) });
        }
      }
      // Printable heuristic (sample first 512 bytes)
      let printable = 0;
      const sampleLen = Math.min(bytes.length, 512);
      for (let i = 0; i < sampleLen; i++) {
        const b = bytes[i];
        if (b === 9 || b === 10 || b === 13 || (b >= 32 && b <= 126)) printable++;
      }
      const ratio = sampleLen ? printable / sampleLen : 0;
      if (ratio > 0.85) {
        return { kind: "text", data: asText, bytes };
      }
    }
    return { kind: "binary", data: bytes, bytes };
  }

  /**
   * Smart reader: if hash is a quilt blob, extract first file; if patch ID, read directly
   */
  async getRawFromQuiltOrPatch(patchId: WalrusPatchId): Promise<Buffer> {
    logger.debug("SdkWalrus.getRawFromQuiltOrPatch start", { patchId });
    
    // First try reading as quilt and extracting first file
    try {
      const files = await this.readFromQuilt(patchId);
      if (files.length > 0) {
        logger.info("SdkWalrus.getRawFromQuiltOrPatch extracted from quilt", { 
          patchId, 
          fileCount: files.length,
          size: files[0].data.length 
        });
        return Buffer.from(files[0].data);
      }
    } catch (err) {
      logger.debug("SdkWalrus.getRawFromQuiltOrPatch not a quilt, trying direct read", { 
        patchId, 
        error: err instanceof Error ? err.message : String(err) 
      });
    }
    
    // Fallback: read directly (patch ID or simple blob)
    return this.getRaw(patchId);
  }

  /**
   * Read by Patch ID - the correct way to read files from Walrus
   * Uses getFiles() which returns both the data AND the identifier (filename)
   * The identifier tells us the content type:
   * - *.jpg, *.png, *.gif, *.webp → image
   * - *.json → JSON data (parse it to get content)
   */
  async readByPatchId(patchId: string): Promise<{ data: Buffer; identifier: string; isImage: boolean; isJson: boolean }> {
    logger.debug("SdkWalrus.readByPatchId start", { patchId });
    
    const [file] = await this.walrusClient.walrus.getFiles({ ids: [patchId] });
    
    if (!file) {
      throw new Error(`File not found for patch ID: ${patchId}`);
    }
    
    const identifier = await file.getIdentifier() ?? patchId;
    const bytes = await file.bytes();
    const data = Buffer.from(bytes);
    
    // Determine content type from identifier (filename)
    const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(identifier);
    const isJson = /\.json$/i.test(identifier);
    
    logger.info("SdkWalrus.readByPatchId success", { 
      patchId, 
      identifier, 
      size: data.length, 
      isImage, 
      isJson 
    });
    
    return { data, identifier, isImage, isJson };
  }

  /**
   * FASTEST: Fetch via aggregator URL (HTTP fetch, ~100-300ms)
   * This is the BEST option for a social media app!
   * 
   * URL format: {aggregator}/v1/blobs/by-quilt-patch-id/{patchId}
   * 
   * The aggregator returns:
   * - Body: raw file data
   * - Header x-quilt-patch-identifier: the filename (e.g., "photo.jpg")
   * - Header content-type: the MIME type
   */
  async fetchByPatchId(patchId: string): Promise<{ data: Buffer; identifier: string; contentType: string }> {
    const url = `${WALRUS_AGGREGATOR_URL}/v1/blobs/by-quilt-patch-id/${patchId}`;
    logger.debug("SdkWalrus.fetchByPatchId start", { patchId, url });
    
    const startTime = performance.now();
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`Aggregator fetch failed: ${response.status} ${response.statusText}`);
    }
    
    const arrayBuffer = await response.arrayBuffer();
    const data = Buffer.from(arrayBuffer);
    
    // Get identifier from header (the filename)
    const identifier = response.headers.get("x-quilt-patch-identifier") ?? patchId;
    const contentType = response.headers.get("content-type") ?? "application/octet-stream";
    
    const duration = performance.now() - startTime;
    logger.info("SdkWalrus.fetchByPatchId success", { 
      patchId, 
      identifier, 
      contentType,
      size: data.length,
      durationMs: Math.round(duration)
    });
    
    return { data, identifier, contentType };
  }

  /**
   * Write multiple files as a single quilt with explicit certification
   * This is the MOST COST-EFFECTIVE approach for batching
   */
  async writeFiles(files: Array<{ contents: Uint8Array; identifier: string; tags?: Record<string, string> }>): Promise<WriteFilesResult> {
    logger.debug("SdkWalrus.writeFiles start", { count: files.length });

    const walrusFiles = files.map(f => 
      WalrusFile.from({
        contents: f.contents,
        identifier: f.identifier,
        tags: f.tags,
      })
    );

    const result = await this.writeFilesWithCertification(walrusFiles);
    
    // For quilts, all files share the same blobId
    const output: WriteFilesResult = result.files.map(f => ({
      id: f.id,
      blobId: result.blobId,
    }));

    logger.info("SdkWalrus.writeFiles success", { 
      count: files.length, 
      blobId: result.blobId 
    });
    return output;
  }

  /**
   * Core method: Write files using writeFilesFlow with explicit certification
   * Follows the guide's recommended pattern:
   * 1. Create flow and encode
   * 2. Register blob on-chain
   * 3. Upload to storage nodes
   * 4. Certify the blob (CRITICAL - ensures blob is readable)
   * 
   * Returns:
   * - blobId: The quilt/blob container ID (shared by all files)
   * - patchId: The first file's patch ID (for single file uploads)
   * - files: All files with their individual patch IDs
   */
  private async writeFilesWithCertification(walrusFiles: WalrusFile[]): Promise<{ blobId: string; patchId: string; files: Array<{ id: string }> }> {
    logger.debug("writeFilesWithCertification start", { fileCount: walrusFiles.length });

    // Step 1: Create the flow and encode
    const flow = this.walrusClient.walrus.writeFilesFlow({ files: walrusFiles });
    
    logger.debug("writeFilesWithCertification encoding...");
    await flow.encode();
    logger.debug("writeFilesWithCertification encoded");

    // Step 2: Register the blob on-chain
    logger.debug("writeFilesWithCertification registering...", { 
      owner: this.owner, 
      epochs: WALRUS_EPOCHS, 
      deletable: WALRUS_DELETABLE 
    });
    
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
      logger.error("writeFilesWithCertification register failed", { 
        error: registerResult.effects?.status?.error 
      });
      throw new Error(`Registration transaction failed: ${registerResult.effects?.status?.error}`);
    }
    
    logger.info("writeFilesWithCertification registered", { digest: registerResult.digest });

    // Step 3: Upload to storage nodes
    logger.debug("writeFilesWithCertification uploading...", { digest: registerResult.digest });
    try {
      await flow.upload({ digest: registerResult.digest });
      logger.info("writeFilesWithCertification uploaded successfully");
    } catch (err) {
      logger.error("writeFilesWithCertification upload failed", { 
        error: err instanceof Error ? err.message : String(err),
        digest: registerResult.digest 
      });
      throw err;
    }

    // Step 4: CERTIFY THE BLOB (this is the critical step that was missing!)
    logger.debug("writeFilesWithCertification certifying...");
    const certifyTx = flow.certify();
    
    const certifyResult = await this.suiClient.signAndExecuteTransaction({
      transaction: certifyTx,
      signer: this.signer,
      options: { showEffects: true },
    });

    if (certifyResult.effects?.status?.status !== "success") {
      logger.error("writeFilesWithCertification certify failed", { 
        error: certifyResult.effects?.status?.error 
      });
      throw new Error(`Certification transaction failed: ${certifyResult.effects?.status?.error}`);
    }
    
    logger.info("writeFilesWithCertification certified", { digest: certifyResult.digest });

    // Step 5: Get the final blob info
    const fileResults = await flow.listFiles();
    
    // blobId = The quilt/blob container (shared by all files in this upload)
    // patchId = The individual file's ID (use this to fetch the specific file)
    const blobId = fileResults[0]?.blobId ?? "";
    const patchId = fileResults[0]?.id ?? "";
    
    logger.info("writeFilesWithCertification complete", { 
      blobId,
      patchId,
      fileCount: fileResults.length
    });

    return {
      blobId,
      patchId,
      files: fileResults.map((f: any) => ({ id: f.id })),
    };
  }

  /**
   * Read files from a quilt with optional filtering by identifiers or tags
   * Use this to selectively load comments, messages, etc. from a batch
   */
  async readFromQuilt(blobId: string, filters?: { identifiers?: string[]; tags?: Record<string, string>[] }): Promise<Array<{ identifier: string; data: Uint8Array }>> {
    logger.debug("SdkWalrus.readFromQuilt start", { blobId, filters });
    
    try {
      // Get the blob object using getBlob
      const blob = await this.walrusClient.walrus.getBlob({ blobId });
      
      // Query files with optional filtering
      const files = await blob.files(filters ? {
        identifiers: filters.identifiers,
        tags: filters.tags,
      } : undefined);

      const results: Array<{ identifier: string; data: Uint8Array }> = [];
      for (const file of files) {
        const identifier = await file.getIdentifier();
        const data = await file.bytes();
        results.push({ identifier: identifier ?? blobId, data });
      }

      logger.debug("SdkWalrus.readFromQuilt success", { blobId, count: results.length });
      return results;
    } catch (err) {
      logger.error("SdkWalrus.readFromQuilt failed", { 
        blobId, 
        error: err instanceof Error ? err.message : String(err) 
      });
      return [];
    }
  }

  /**
   * Estimate storage cost before committing
   */
  async estimateCost(sizeBytes: number, epochs: number = WALRUS_EPOCHS): Promise<{ storageCost: bigint; writeCost: bigint; totalCost: bigint }> {
    logger.debug("SdkWalrus.estimateCost", { sizeBytes, epochs });
    const cost = await this.walrusClient.walrus.storageCost(sizeBytes, epochs);
    logger.debug("SdkWalrus.estimateCost result", { 
      storageCost: cost.storageCost.toString(), 
      writeCost: cost.writeCost.toString(),
      totalCost: cost.totalCost.toString() 
    });
    return cost;
  }

  /**
   * Certify an existing uncertified blob
   * Use this to fix blobs that were registered but not certified
   */
  async certifyBlob(blobId: string, blobObjectId: string): Promise<string> {
    logger.info("SdkWalrus.certifyBlob start", { blobId, blobObjectId });

    // Get storage confirmations from nodes
    const status = await this.walrusClient.walrus.getVerifiedBlobStatus({ blobId });
    
    if (status.status === "certified") {
      logger.info("SdkWalrus.certifyBlob already certified", { blobId });
      return blobId;
    }

    if (!status.confirmations || status.confirmations.length === 0) {
      throw new Error(`Cannot certify blob ${blobId}: no storage confirmations available`);
    }

    // Create and execute certification transaction
    const certifyTx = this.walrusClient.walrus.certifyBlobTransaction({
      blobId,
      blobObjectId,
      confirmations: status.confirmations,
      deletable: WALRUS_DELETABLE,
    });

    const result = await this.suiClient.signAndExecuteTransaction({
      transaction: certifyTx,
      signer: this.signer,
      options: { showEffects: true },
    });

    if (result.effects?.status?.status !== "success") {
      throw new Error(`Certification failed: ${result.effects?.status?.error}`);
    }

    logger.info("SdkWalrus.certifyBlob success", { blobId, digest: result.digest });
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
export const walrusIO: IWalrus = walrusInstance;

const jsonMeta = (prefix: string): WalrusUploadMetadata => ({
  identifier: `${prefix}-${Date.now()}.json`,
  mime: "application/json",
});

// =============================================================================
// High-level helpers for common social app patterns
// =============================================================================

// Single object storage (flows, actions, chats, groups)
// These now return { blobId, patchId } - use patchId to fetch the data!
export const storeFlowObject = (obj: FlowObject) => walrusIO.putJson(obj, jsonMeta("flow"));
export const loadFlowObject = (patchId: WalrusPatchId) => walrusIO.getJson<FlowObject>(patchId);

export const storeActionObject = (obj: ActionObject) => walrusIO.putJson(obj, jsonMeta("action"));
export const storeChatObject = (obj: ChatObject) => walrusIO.putJson(obj, jsonMeta("chat"));
export const storeGroupMeta = (obj: GroupMetaObject) => walrusIO.putJson(obj, jsonMeta("group"));
export const storeText = (text: string, identifier?: string) =>
  walrusIO.putRaw(Buffer.from(text, "utf8"), {
    identifier: identifier ?? `text-${Date.now()}.txt`,
    mime: "text/plain",
  });

/**
 * Store multiple chat messages as a quilt (COST-EFFECTIVE batching)
 * Returns the quilt blobId and individual message ids
 */
export async function storeChatBatch(messages: Array<{ id: string; obj: ChatObject }>): Promise<{ blobId: string; messageIds: Record<string, string> }> {
  const files = messages.map(m => ({
    contents: new TextEncoder().encode(JSON.stringify(m.obj)),
    identifier: `chat-${m.id}`,
    tags: { "content-type": "application/json", kind: "chat" },
  }));
  
  const results = await walrusIO.writeFiles(files);
  const blobId = results[0]?.blobId ?? "";
  const messageIds: Record<string, string> = {};
  for (let i = 0; i < messages.length; i++) {
    messageIds[messages[i].id] = results[i].id;
  }
  return { blobId, messageIds };
}

/**
 * Store multiple actions (glows, promotes) as a quilt (COST-EFFECTIVE batching)
 */
export async function storeActionBatch(actions: Array<{ id: string; obj: ActionObject }>): Promise<{ blobId: string; actionIds: Record<string, string> }> {
  const files = actions.map(a => ({
    contents: new TextEncoder().encode(JSON.stringify(a.obj)),
    identifier: `action-${a.id}`,
    tags: { "content-type": "application/json", kind: "action" },
  }));
  
  const results = await walrusIO.writeFiles(files);
  const blobId = results[0]?.blobId ?? "";
  const actionIds: Record<string, string> = {};
  for (let i = 0; i < actions.length; i++) {
    actionIds[actions[i].id] = results[i].id;
  }
  return { blobId, actionIds };
}

/**
 * Read chat messages from a quilt, optionally filtering by message IDs
 */
export async function loadChatBatch(blobId: string, messageIds?: string[]): Promise<ChatObject[]> {
  const results = await walrusIO.readFromQuilt(blobId, messageIds ? { identifiers: messageIds } : undefined);
  return results.map(r => JSON.parse(new TextDecoder().decode(r.data)) as ChatObject);
}

/**
 * Estimate cost for storing data
 */
export async function estimateStorageCost(sizeBytes: number, epochs?: number) {
  return walrusIO.estimateCost(sizeBytes, epochs);
}

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

function getSdkWalrusClient() {
  if (!cachedWalrusClient) {
    logger.debug("Initializing Walrus client", { network: WALRUS_NETWORK });
    const suiClient = getSdkSuiClient();
    
    try {
      const extended = suiClient.$extend(
        walrus({
          network: WALRUS_NETWORK,
          wasmUrl: WALRUS_WASM_URL,
          storageNodeClientOptions: {
            fetch: (url, options) => {
              logger.debug("Walrus storage node fetch", { url: String(url) });
              return fetch(url as any, options as any);
            },
            timeout: WALRUS_STORAGE_TIMEOUT_MS,
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
        })
      );
      cachedWalrusClient = extended;
      logger.info("Walrus client initialized via extension", { network: WALRUS_NETWORK });
    } catch (err) {
      logger.error("Failed to initialize Walrus client", { error: err instanceof Error ? err.message : String(err) });
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
