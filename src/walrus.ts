import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import axios from "axios";
import type { ActionObject, ChatObject, FlowObject, GroupMetaObject, WalrusHash } from "./types.js";

const MODE = process.env.WALRUS_MODE ?? "mock"; // mock | real
const BASE = process.env.WALRUS_BASE_URL ?? "http://localhost:3001";
const DATA_DIR = path.resolve(process.cwd(), "data", "walrus");

async function ensureDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}
function sha256(buffer: Buffer): WalrusHash {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

export interface IWalrus {
  putRaw(buffer: Buffer): Promise<WalrusHash>;
  getRaw(hash: WalrusHash): Promise<Buffer>;
  putJson<T extends object>(obj: T): Promise<WalrusHash>;
  getJson<T = unknown>(hash: WalrusHash): Promise<T>;
}

class MockWalrus implements IWalrus {
  async putRaw(buffer: Buffer): Promise<WalrusHash> {
    await ensureDir();
    const hash = sha256(buffer);
    await fs.writeFile(path.join(DATA_DIR, hash), buffer);
    return hash;
  }
  async getRaw(hash: WalrusHash): Promise<Buffer> {
    return fs.readFile(path.join(DATA_DIR, hash));
  }
  async putJson<T extends object>(obj: T): Promise<WalrusHash> {
    const buf = Buffer.from(JSON.stringify(obj));
    return this.putRaw(buf);
  }
  async getJson<T = unknown>(hash: WalrusHash): Promise<T> {
    const buf = await this.getRaw(hash);
    return JSON.parse(buf.toString("utf8")) as T;
  }
}

class RealWalrus implements IWalrus {
  async putRaw(buffer: Buffer): Promise<WalrusHash> {
    const res = await axios.post(`${BASE}/upload`, buffer, {
      headers: { "Content-Type": "application/octet-stream", "x-api-key": process.env.WALRUS_API_KEY ?? "" }
    });
    return res.data.hash as WalrusHash;
  }
  async getRaw(hash: WalrusHash): Promise<Buffer> {
    const res = await axios.get(`${BASE}/object/${hash}`, { responseType: "arraybuffer" });
    return Buffer.from(res.data);
  }
  async putJson<T extends object>(obj: T): Promise<WalrusHash> {
    const res = await axios.post(`${BASE}/uploadJson`, obj, {
      headers: { "Content-Type": "application/json", "x-api-key": process.env.WALRUS_API_KEY ?? "" }
    });
    return res.data.hash as WalrusHash;
  }
  async getJson<T = unknown>(hash: WalrusHash): Promise<T> {
    const res = await axios.get(`${BASE}/json/${hash}`);
    return res.data as T;
  }
}

export const walrus: IWalrus = MODE === "real" ? new RealWalrus() : new MockWalrus();

// high-level helpers
export const storeFlowObject = (obj: FlowObject) => walrus.putJson(obj);
export const loadFlowObject = (hash: WalrusHash) => walrus.getJson<FlowObject>(hash);

export const storeActionObject = (obj: ActionObject) => walrus.putJson(obj);
export const storeChatObject = (obj: ChatObject) => walrus.putJson(obj);
export const storeGroupMeta = (obj: GroupMetaObject) => walrus.putJson(obj);
