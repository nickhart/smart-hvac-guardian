import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveFrom, createResendSender, DEFAULT_EMAIL_FROM } from "@/utils/email";
import type { EnvSecrets } from "@/config/schema";

const send = vi.fn();

vi.mock("resend", () => ({
  Resend: vi.fn(() => ({ emails: { send } })),
}));

const baseSecrets: EnvSecrets = {
  yolinkUaCid: "ua-cid",
  yolinkSecretKey: "secret-key",
  iftttWebhookKey: "ifttt-key",
  qstashToken: "qstash-token",
  qstashCurrentSigningKey: "current-key",
  qstashNextSigningKey: "next-key",
  upstashRedisUrl: "https://redis.upstash.io",
  upstashRedisToken: "redis-token",
  resendApiKey: "re_test_123",
};

describe("resolveFrom", () => {
  it("wraps the default address in the default site name", () => {
    expect(resolveFrom(baseSecrets)).toBe(`HVAC Guardian <${DEFAULT_EMAIL_FROM}>`);
  });

  it("wraps a bare EMAIL_FROM in the configured site name", () => {
    expect(resolveFrom({ ...baseSecrets, siteName: "Zolite", emailFrom: "hi@zolite.app" })).toBe(
      "Zolite <hi@zolite.app>",
    );
  });

  it("passes through an EMAIL_FROM that already has a display name", () => {
    const emailFrom = "Support <support@zolite.app>";
    expect(resolveFrom({ ...baseSecrets, siteName: "Zolite", emailFrom })).toBe(emailFrom);
  });
});

describe("createResendSender", () => {
  beforeEach(() => send.mockReset());

  it("sends with the resolved From address", async () => {
    send.mockResolvedValue({ data: { id: "abc" }, error: null });

    await createResendSender(baseSecrets)("user@example.com", "Your login link", "body");

    expect(send).toHaveBeenCalledWith({
      from: `HVAC Guardian <${DEFAULT_EMAIL_FROM}>`,
      to: "user@example.com",
      subject: "Your login link",
      text: "body",
    });
  });

  it("throws when Resend returns an error instead of reporting success", async () => {
    send.mockResolvedValue({
      data: null,
      error: { name: "validation_error", message: "The zolite.ai domain is not verified." },
    });

    await expect(
      createResendSender(baseSecrets)("user@example.com", "Your login link", "body"),
    ).rejects.toThrow(/validation_error.*not verified/);
  });
});
