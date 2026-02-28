/**
 * AES-256-GCM encryption/decryption using Web Crypto API (Edge Runtime compatible).
 *
 * Encrypted format: [12-byte IV][ciphertext+tag]
 * Key version is stored alongside the encrypted data in the DB, not embedded here.
 */

const ALGORITHM = "AES-GCM";
const IV_LENGTH = 12;
const KEY_LENGTH = 32; // 256 bits

function getMasterKey(): string {
  const key = process.env.MASTER_ENCRYPTION_KEY;
  if (!key) {
    throw new Error("MASTER_ENCRYPTION_KEY environment variable is not set");
  }
  return key;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function importKey(rawKeyHex?: string): Promise<any> {
  const hex = rawKeyHex ?? getMasterKey();
  if (hex.length !== KEY_LENGTH * 2) {
    throw new Error(
      `MASTER_ENCRYPTION_KEY must be ${KEY_LENGTH * 2} hex characters (${KEY_LENGTH} bytes)`,
    );
  }

  const keyBytes = new Uint8Array(KEY_LENGTH);
  for (let i = 0; i < KEY_LENGTH; i++) {
    keyBytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }

  return crypto.subtle.importKey("raw", keyBytes, { name: ALGORITHM }, false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function encrypt(plaintext: string, masterKeyHex?: string): Promise<Uint8Array> {
  const key = await importKey(masterKeyHex);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const encoded = new TextEncoder().encode(plaintext);

  const ciphertext = await crypto.subtle.encrypt({ name: ALGORITHM, iv }, key, encoded);

  // Prepend IV to ciphertext
  const result = new Uint8Array(IV_LENGTH + ciphertext.byteLength);
  result.set(iv, 0);
  result.set(new Uint8Array(ciphertext), IV_LENGTH);
  return result;
}

/**
 * Timing-safe string comparison (Edge Runtime compatible).
 * Prevents timing attacks when comparing secrets.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const aBuf = encoder.encode(a);
  const bBuf = encoder.encode(b);

  if (aBuf.length !== bBuf.length) {
    // Compare against self to keep constant time, then return false
    let result = 1;
    for (let i = 0; i < aBuf.length; i++) {
      result |= aBuf[i] ^ aBuf[i];
    }
    // Use result to prevent compiler optimization
    return result === 0;
  }

  let result = 0;
  for (let i = 0; i < aBuf.length; i++) {
    result |= aBuf[i] ^ bBuf[i];
  }
  return result === 0;
}

export async function decrypt(data: Uint8Array, masterKeyHex?: string): Promise<string> {
  if (data.length < IV_LENGTH + 1) {
    throw new Error("Encrypted data too short");
  }

  const key = await importKey(masterKeyHex);
  const iv = data.slice(0, IV_LENGTH);
  const ciphertext = data.slice(IV_LENGTH);

  const decrypted = await crypto.subtle.decrypt({ name: ALGORITHM, iv }, key, ciphertext);

  return new TextDecoder().decode(decrypted);
}
