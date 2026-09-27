import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveFrom, createResendSender, emailStatus } from "@/utils/email";
import type { EnvSecrets } from "@/config/schema";

const send = vi.fn();

vi.mock("resend", () => ({
  Resend: vi.fn(() => ({ emails: { send } })),
}));

const baseSecrets: EnvSecrets = {
  qstashToken: "qstash-token",
  qstashCurrentSigningKey: "current-key",
  qstashNextSigningKey: "next-key",
  upstashRedisUrl: "https://redis.upstash.io",
  upstashRedisToken: "redis-token",
  resendApiKey: "re_test_123",
  emailFrom: "noreply@example.com",
};

describe("emailStatus", () => {
  it("is ok with a Resend key and a sender", () => {
    expect(emailStatus(baseSecrets)).toBe("ok");
  });

  it("is not configured without a Resend key", () => {
    expect(emailStatus({ ...baseSecrets, resendApiKey: undefined })).toBe("not_configured");
  });

  /**
   * There used to be a built-in sender on the original deployment's domain.
   * Resend only sends from domains verified in the same account, so for
   * anyone else it meant every sign-in email was rejected.
   */
  it("fails with a Resend key but no sender, rather than falling back to one", () => {
    expect(emailStatus({ ...baseSecrets, emailFrom: undefined })).toBe("fail");
  });
});

describe("resolveFrom", () => {
  it("wraps a bare EMAIL_FROM in the default site name", () => {
    expect(resolveFrom(baseSecrets)).toBe("HVAC Guardian <noreply@example.com>");
  });

  it("wraps a bare EMAIL_FROM in the configured site name", () => {
    expect(resolveFrom({ ...baseSecrets, siteName: "Guardian", emailFrom: "hi@example.com" })).toBe(
      "Guardian <hi@example.com>",
    );
  });

  it("passes through an EMAIL_FROM that already has a display name", () => {
    const emailFrom = "Support <support@example.com>";
    expect(resolveFrom({ ...baseSecrets, siteName: "Guardian", emailFrom })).toBe(emailFrom);
  });

  it("throws without EMAIL_FROM instead of inventing a sender", () => {
    expect(() => resolveFrom({ ...baseSecrets, emailFrom: undefined })).toThrow("EMAIL_FROM");
  });
});

describe("createResendSender", () => {
  beforeEach(() => send.mockReset());

  it("sends with the resolved From address", async () => {
    send.mockResolvedValue({ data: { id: "abc" }, error: null });

    await createResendSender(baseSecrets)("user@example.com", "Your login link", "body");

    expect(send).toHaveBeenCalledWith({
      from: "HVAC Guardian <noreply@example.com>",
      to: "user@example.com",
      subject: "Your login link",
      text: "body",
    });
  });

  it("throws when Resend returns an error instead of reporting success", async () => {
    send.mockResolvedValue({
      data: null,
      error: { name: "validation_error", message: "The example.com domain is not verified." },
    });

    await expect(
      createResendSender(baseSecrets)("user@example.com", "Your login link", "body"),
    ).rejects.toThrow(/validation_error.*not verified/);
  });
});
