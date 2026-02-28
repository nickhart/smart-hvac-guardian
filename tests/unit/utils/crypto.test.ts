import { describe, it, expect } from "vitest";
import { timingSafeEqual } from "@/utils/crypto";

describe("timingSafeEqual", () => {
  it("returns true for identical strings", () => {
    expect(timingSafeEqual("abc123", "abc123")).toBe(true);
  });

  it("returns true for empty strings", () => {
    expect(timingSafeEqual("", "")).toBe(true);
  });

  it("returns false for different strings of same length", () => {
    expect(timingSafeEqual("abc123", "abc124")).toBe(false);
  });

  it("returns false for different lengths", () => {
    expect(timingSafeEqual("short", "longer-string")).toBe(false);
  });

  it("returns false when first is empty and second is not", () => {
    expect(timingSafeEqual("", "notempty")).toBe(false);
  });

  it("returns false when second is empty and first is not", () => {
    expect(timingSafeEqual("notempty", "")).toBe(false);
  });

  it("handles long hex strings like webhook secrets", () => {
    const secret = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2";
    expect(timingSafeEqual(secret, secret)).toBe(true);
    expect(timingSafeEqual(secret, secret.slice(0, -1) + "0")).toBe(false);
  });
});
