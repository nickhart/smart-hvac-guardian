import { Resend } from "resend";
import type { EnvSecrets } from "../config/schema.js";

/** Fallback sender. Must live on a domain verified in Resend, or sends 403. */
export const DEFAULT_EMAIL_FROM = "noreply@zolite.app";

export type SendEmail = (to: string, subject: string, text: string) => Promise<void>;

/**
 * Build the From header, e.g. `HVAC Guardian <noreply@zolite.app>`.
 * EMAIL_FROM may be a bare address or already carry its own display name.
 */
export function resolveFrom(secrets: EnvSecrets): string {
  const from = secrets.emailFrom ?? DEFAULT_EMAIL_FROM;
  if (from.includes("<")) return from;
  return `${secrets.siteName ?? "HVAC Guardian"} <${from}>`;
}

/**
 * Resend's SDK resolves with `{ data, error }` rather than rejecting on API
 * errors, so an unverified sending domain or a revoked key otherwise looks
 * exactly like a successful send. Surface it as a throw.
 */
export function createResendSender(secrets: EnvSecrets): SendEmail {
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
