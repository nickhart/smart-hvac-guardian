import { Resend } from "resend";
import type { EnvSecrets } from "../config/schema.js";

export type SendEmail = (to: string, subject: string, text: string) => Promise<void>;

type EmailSecrets = Pick<EnvSecrets, "resendApiKey" | "emailFrom" | "siteName">;

/**
 * Whether sign-in email can be sent.
 *
 * It takes both a Resend key and a sender, and there is no default sender:
 * Resend only sends from a domain verified in the same account, so any
 * built-in address would belong to someone else's domain and every send
 * would be rejected. A key with no sender is therefore a misconfiguration,
 * not a fallback.
 */
export function emailStatus(secrets: EmailSecrets): "ok" | "fail" | "not_configured" {
  if (!secrets.resendApiKey) return "not_configured";
  return secrets.emailFrom ? "ok" : "fail";
}

/**
 * Build the From header, e.g. `HVAC Guardian <noreply@example.com>`.
 * EMAIL_FROM may be a bare address or already carry its own display name.
 */
export function resolveFrom(secrets: EmailSecrets): string {
  const from = secrets.emailFrom;
  if (!from) throw new Error("EMAIL_FROM is not set");
  if (from.includes("<")) return from;
  return `${secrets.siteName ?? "HVAC Guardian"} <${from}>`;
}

/**
 * Resend's SDK resolves with `{ data, error }` rather than rejecting on API
 * errors, so an unverified sending domain or a revoked key otherwise looks
 * exactly like a successful send. Surface it as a throw.
 */
export function createResendSender(secrets: EmailSecrets): SendEmail {
  return async (to, subject, text) => {
    const resend = new Resend(secrets.resendApiKey);
    const { error } = await resend.emails.send({
      from: resolveFrom(secrets),
      to,
      subject,
      text,
    });
    if (error) {
      throw new Error(`Resend rejected the email (${error.name}): ${error.message}`);
    }
  };
}
