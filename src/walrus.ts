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
  const base64 = process.env.SUI_SECRET_KEY_BASE64;
  if (!base64) throw new Error('Missing SUI_SECRET_KEY_BASE64 in .env');
  const bytes = Buffer.from(base64, 'base64');
  return Ed25519Keypair.fromSecretKey(bytes);
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
