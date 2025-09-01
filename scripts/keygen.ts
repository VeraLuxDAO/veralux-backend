import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';

const keypair = new Ed25519Keypair();
const secret = Buffer.from(keypair.getSecretKey()).toString('base64');
const address = keypair.getPublicKey().toSuiAddress();

console.log('SUI Address:', address);
console.log('SUI_SECRET_KEY_BASE64:', secret);
console.log('\nPaste SUI_SECRET_KEY_BASE64 into your .env');
