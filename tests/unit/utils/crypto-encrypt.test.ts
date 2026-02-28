import { describe, it, expect } from "vitest";
import { encrypt, decrypt } from "@/utils/crypto";

// 32-byte test key as 64 hex chars
const TEST_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("encrypt/decrypt", () => {
  it("round-trips a plaintext string", async () => {
    const plaintext = "hello world";
    const encrypted = await encrypt(plaintext, TEST_KEY);
    const decrypted = await decrypt(encrypted, TEST_KEY);
    expect(decrypted).toBe(plaintext);
  });

  it("produces different ciphertext for same plaintext (random IV)", async () => {
    const plaintext = "same input";
    const a = await encrypt(plaintext, TEST_KEY);
    const b = await encrypt(plaintext, TEST_KEY);
    // Encrypted bytes should differ due to random IV
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });

  it("handles empty string", async () => {
    const encrypted = await encrypt("", TEST_KEY);
    const decrypted = await decrypt(encrypted, TEST_KEY);
    expect(decrypted).toBe("");
  });

  it("handles long strings", async () => {
    const plaintext = "x".repeat(10000);
    const encrypted = await encrypt(plaintext, TEST_KEY);
    const decrypted = await decrypt(encrypted, TEST_KEY);
    expect(decrypted).toBe(plaintext);
  });

  it("throws on invalid key length", async () => {
    await expect(encrypt("test", "short")).rejects.toThrow("hex characters");
  });

  it("throws on data too short to decrypt", async () => {
    await expect(decrypt(new Uint8Array(5), TEST_KEY)).rejects.toThrow("too short");
  });

  it("throws on tampered ciphertext", async () => {
    const encrypted = await encrypt("secret", TEST_KEY);
    // Flip a byte in the ciphertext portion
    encrypted[encrypted.length - 1] ^= 0xff;
    await expect(decrypt(encrypted, TEST_KEY)).rejects.toThrow();
  });
});
