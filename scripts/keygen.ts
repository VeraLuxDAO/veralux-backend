import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';

const kp = new Ed25519Keypair();
// getSecretKey() typically returns 64 bytes (priv + pub). Use first 32 as seed:
const full = kp.getSecretKey();
const seed32 = full.slice(0, 32);

const b64 = Buffer.from(seed32).toString('base64');
const hex = Buffer.from(seed32).toString('hex');

console.log('SUI Address:', kp.getPublicKey().toSuiAddress());
console.log('SUI_SECRET_KEY_BASE64:', b64);
console.log('SUI_SECRET_KEY_HEX:', '0x' + hex);
console.log('\nUse either env var. Fund this address with testnet SUI + WAL.');
