import { describe, it, expect, vi, beforeEach } from "vitest";
import { createLogger } from "@/utils/logger";

describe("createLogger", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("logs info messages as JSON", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const logger = createLogger("info");
    logger.info("test message", { key: "value" });

    expect(spy).toHaveBeenCalledOnce();
    const parsed = JSON.parse(spy.mock.calls[0][0] as string);
    expect(parsed.level).toBe("info");
    expect(parsed.message).toBe("test message");
    expect(parsed.key).toBe("value");
    expect(parsed.timestamp).toBeDefined();
  });

  it("filters messages below minimum level", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const logger = createLogger("warn");
    logger.debug("hidden");
    logger.info("hidden");

    expect(spy).not.toHaveBeenCalled();
  });

  it("routes error messages to console.error", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logger = createLogger("error");
    logger.error("boom");

    expect(spy).toHaveBeenCalledOnce();
  });

  it("routes warn messages to console.warn", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logger = createLogger("warn");
    logger.warn("caution");

    expect(spy).toHaveBeenCalledOnce();
  });

  it("includes debug messages when level is debug", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const logger = createLogger("debug");
    logger.debug("details");

    expect(spy).toHaveBeenCalledOnce();
  });
});
