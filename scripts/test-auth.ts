/**
 * Test script for wallet authentication
 * 
 * This simulates what a frontend wallet would do:
 * 1. Request a nonce
 * 2. Sign the message with a private key
 * 3. Submit the signature to authenticate
 * 
 * Usage:
 *   npm run test:auth
 */

import crypto from "node:crypto";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { toBase64, fromBase64 } from "@mysten/sui/utils";

const API_URL = process.env.API_URL || "http://localhost:4000";

// Generate a test wallet (or use existing private key)
const TEST_PRIVATE_KEY = process.env.TEST_WALLET_KEY;
let keypair: Ed25519Keypair;

if (TEST_PRIVATE_KEY) {
  // Use existing key from env
  // The key should be in the format "suiprivkey..." (base64 encoded)
  try {
    keypair = Ed25519Keypair.fromSecretKey(TEST_PRIVATE_KEY);
    console.log("✅ Using existing wallet from TEST_WALLET_KEY");
  } catch (error) {
    console.error("❌ Invalid TEST_WALLET_KEY format. Expected 'suiprivkey...' format");
    process.exit(1);
  }
} else {
  // Generate new random wallet for testing
  keypair = new Ed25519Keypair();
  console.log("✅ Generated new test wallet");
  const exportedKey = keypair.getSecretKey();
  console.log(`   Add to .env: TEST_WALLET_KEY=${exportedKey}`);
}

const walletAddress = keypair.toSuiAddress();
const pubKey = keypair.getPublicKey();
console.log(`\n📍 Wallet Address: ${walletAddress}`);
console.log(`🔑 Public Key: ${pubKey.toBase64()}\n`);

// Step 1: Request nonce
console.log("Step 1: Requesting nonce...");
const nonceResponse = await fetch(
  `${API_URL}/auth/nonce?walletAddress=${walletAddress}`
);

if (!nonceResponse.ok) {
  console.error("❌ Failed to get nonce:", await nonceResponse.text());
  process.exit(1);
}

const nonceData = await nonceResponse.json();
console.log("✅ Nonce received");
console.log(`   Message to sign:\n   ${nonceData.message.replace(/\n/g, '\n   ')}`);
console.log(`   Expires: ${nonceData.expiresAt}\n`);

// Step 2: Sign the message
console.log("Step 2: Signing message with wallet...");

// Sui personal message format: intent bytes [3, 0, 0] + message
const intentBytes = new Uint8Array([3, 0, 0]);
const messageBytes = new TextEncoder().encode(nonceData.message);
const fullMessage = new Uint8Array(intentBytes.length + messageBytes.length);
fullMessage.set(intentBytes);
fullMessage.set(messageBytes, intentBytes.length);

// Hash with SHA-256 (in production, this would be Blake2b)
const hash = crypto.createHash("sha256").update(fullMessage).digest();

// Sign the hash
const signatureBytes = await keypair.sign(hash);

// Format: [scheme_flag (0x00 for Ed25519)] + [signature (64 bytes)] + [public_key (32 bytes)]
const publicKey = keypair.getPublicKey();
const publicKeyBytes = publicKey.toRawBytes();
const fullSignature = new Uint8Array(1 + signatureBytes.length + publicKeyBytes.length);
fullSignature[0] = 0x00; // Ed25519 scheme flag
fullSignature.set(signatureBytes, 1);
fullSignature.set(publicKeyBytes, 1 + signatureBytes.length);

const signature = toBase64(fullSignature);
console.log("✅ Message signed");
console.log(`   Signature: ${signature.substring(0, 50)}...\n`);

// Step 3: Authenticate
console.log("Step 3: Authenticating with signature...");
const authResponse = await fetch(`${API_URL}/auth`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    walletAddress,
    signature
  })
});

if (!authResponse.ok) {
  const error = await authResponse.json();
  console.error("❌ Authentication failed:", error);
  process.exit(1);
}

const authData = await authResponse.json();
console.log("✅ Authentication successful!\n");
console.log("🎫 Access Token:", authData.accessToken.substring(0, 50) + "...");
console.log("🔄 Refresh Token:", authData.refreshToken.substring(0, 50) + "...");
console.log(`⏱️  Expires in: ${authData.expiresIn} seconds (${Math.floor(authData.expiresIn / 60)} minutes)\n`);
console.log("👤 User Profile:");
console.log(`   ID: ${authData.user.id}`);
console.log(`   Wallet: ${authData.user.walletAddress}`);
console.log(`   Username: ${authData.user.username || "(not set)"}`);
console.log(`   Display Name: ${authData.user.displayName || "(not set)"}`);
console.log(`   Created: ${authData.user.createdAt}\n`);

// Step 4: Test authenticated endpoint
console.log("Step 4: Testing authenticated endpoint (/auth/me)...");
const meResponse = await fetch(`${API_URL}/auth/me`, {
  headers: {
    Authorization: `Bearer ${authData.accessToken}`
  }
});

if (!meResponse.ok) {
  console.error("❌ Failed to access protected endpoint:", await meResponse.text());
  process.exit(1);
}

const meData = await meResponse.json();
console.log("✅ Successfully accessed protected endpoint");
console.log(`   Retrieved user: ${meData.user.walletAddress}\n`);

// Step 5: Test token refresh
console.log("Step 5: Testing token refresh...");
const refreshResponse = await fetch(`${API_URL}/auth/refresh`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    refreshToken: authData.refreshToken
  })
});

if (!refreshResponse.ok) {
  console.error("❌ Token refresh failed:", await refreshResponse.text());
  process.exit(1);
}

const refreshData = await refreshResponse.json();
console.log("✅ Token refreshed successfully");
console.log(`   New Access Token: ${refreshData.accessToken.substring(0, 50)}...\n`);

console.log("=" .repeat(60));
console.log("🎉 All authentication tests passed!");
console.log("=" .repeat(60));
console.log("\n💡 To use in your frontend:");
console.log("   1. Call GET /auth/nonce?walletAddress=<address>");
console.log("   2. Sign the returned message with wallet (e.g., Sui Wallet)");
console.log("   3. POST /auth with walletAddress + signature");
console.log("   4. Use accessToken in Authorization: Bearer <token>");
console.log("   5. Refresh with POST /auth/refresh when needed\n");

console.log("📚 Example frontend code:");
console.log(`
// Request nonce
const nonceRes = await fetch(\`\${API_URL}/auth/nonce?walletAddress=\${address}\`);
const { nonce, message } = await nonceRes.json();

// Sign with Sui Wallet
const { signature } = await wallet.signPersonalMessage({
  message: new TextEncoder().encode(message)
});

// Authenticate
const authRes = await fetch(\`\${API_URL}/auth\`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ walletAddress: address, signature })
});
const { accessToken, refreshToken, user } = await authRes.json();

// Use token
const res = await fetch(\`\${API_URL}/flows\`, {
  headers: { 'Authorization': \`Bearer \${accessToken}\` }
});
`);
