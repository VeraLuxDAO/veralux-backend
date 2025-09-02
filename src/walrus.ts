import 'dotenv/config';
import { getFullnodeUrl, SuiClient } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { WalrusClient, WalrusFile } from '@mysten/walrus';

const SUI_URL = process.env.SUI_FULLNODE_URL || getFullnodeUrl(process.env.SUI_NETWORK as 'testnet' | 'mainnet' || 'testnet');
const DEV_NOCHAIN = (process.env.WALRUS_DEV_NOCHAIN === 'true');

const suiClient = new SuiClient({ url: SUI_URL });
const walrusClient = new WalrusClient({
  network: (process.env.SUI_NETWORK as 'testnet' | 'mainnet') || 'testnet',
  suiClient,
});

function getSigner() {
  const seed = getSecretSeedFromEnv(); // returns Uint8Array(32)
  return Ed25519Keypair.fromSecretKey(seed);
}

function getSecretSeedFromEnv(): Uint8Array {
  const b64 = process.env.SUI_SECRET_KEY_BASE64?.trim();
  const hex = process.env.SUI_SECRET_KEY_HEX?.trim();
  const any = process.env.SUI_SECRET_KEY?.trim();

  // Helper
  const asHexBytes = (h: string) => {
    const clean = h.startsWith('0x') ? h.slice(2) : h;
    if (clean.length % 2 !== 0) throw new Error('Odd-length hex');
    return Uint8Array.from(Buffer.from(clean, 'hex'));
  };

  // 1) Prefer explicit base64 seed
  if (b64) {
    const bytes = Buffer.from(b64, 'base64');
    if (bytes.length === 32) return new Uint8Array(bytes);
    if (bytes.length === 64) return new Uint8Array(bytes.slice(0, 32)); // handle 64-byte private keys
    // Sometimes users paste hex *as* base64; detect and convert:
    const maybeAscii = Buffer.from(b64, 'base64').toString('utf8').trim();
    if (/^0x[0-9a-fA-F]+$/.test(maybeAscii) || /^[0-9a-fA-F]+$/.test(maybeAscii)) {
      const hb = asHexBytes(maybeAscii);
      if (hb.length === 32) return hb;
      if (hb.length === 64) return hb.slice(0, 32);
    }
    throw new Error(`Invalid SUI_SECRET_KEY_BASE64 length: ${bytes.length}. Needs 32.`);
  }

  // 2) Hex seed
  if (hex) {
    const hb = asHexBytes(hex);
    if (hb.length === 32) return hb;
    if (hb.length === 64) return hb.slice(0, 32);
    throw new Error(`Invalid SUI_SECRET_KEY_HEX length: ${hb.length}. Needs 32.`);
  }

  // 3) Fallback auto-detect
  if (any) {
    if (/^0x?[0-9a-fA-F]+$/.test(any)) {
      const hb = asHexBytes(any);
      if (hb.length === 32) return hb;
      if (hb.length === 64) return hb.slice(0, 32);
    } else {
      const bb = Buffer.from(any, 'base64');
      if (bb.length === 32) return new Uint8Array(bb);
      if (bb.length === 64) return new Uint8Array(bb.slice(0, 32));
    }
  }

  throw new Error('Missing SUI secret key. Set SUI_SECRET_KEY_BASE64 or SUI_SECRET_KEY_HEX.');
}

export async function storeText(content: string) {
  if (DEV_NOCHAIN) {
    const crypto = await import('node:crypto');
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    return { ok: true, mode: 'dev-nochain', hash };
  }

  const file = WalrusFile.from({
    contents: new TextEncoder().encode(content),
    identifier: 'flow.txt',
    tags: { 'content-type': 'text/plain' },
  });

  const signer = getSigner();
  const results = await walrusClient.writeFiles({
    files: [file],
    epochs: 3,
    deletable: true,
    signer,
  });

  const { id: quiltId, blobId } = results[0]!;
  return { ok: true, mode: 'walrus', quiltId, blobId };
}
