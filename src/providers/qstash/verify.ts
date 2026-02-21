import { Receiver } from "@upstash/qstash";
import { WebhookValidationError } from "../../utils/errors.js";

interface VerifyOptions {
  currentSigningKey: string;
  nextSigningKey: string;
}

export function createQStashReceiver(options: VerifyOptions): Receiver {
  return new Receiver({
    currentSigningKey: options.currentSigningKey,
    nextSigningKey: options.nextSigningKey,
  });
}

export async function verifyQStashSignature(
  receiver: Receiver,
  signature: string,
  body: string,
): Promise<void> {
  const isValid = await receiver.verify({ signature, body }).catch(() => false);

  if (!isValid) {
    throw new WebhookValidationError("Invalid QStash signature");
  }
}
