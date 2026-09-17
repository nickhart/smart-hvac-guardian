import { ProviderError, TerminalProviderError } from "../../utils/errors.js";
import type { Logger } from "../../utils/logger.js";

const IFTTT_BASE_URL = "https://maker.ifttt.com/trigger";

interface IFTTTClientOptions {
  webhookKey: string;
  logger: Logger;
}

/**
 * A 4xx other than 429 means the request itself is wrong — a bad webhook key,
 * an event name that does not exist — and will fail identically forever.
 * Retrying those only multiplies the failure notifications IFTTT sends.
 */
export function isTerminalStatus(status: number): boolean {
  if (status === 429) return false;
  return status >= 400 && status < 500;
}

export class IFTTTClient {
  private readonly webhookKey: string;
  private readonly logger: Logger;

  constructor(options: IFTTTClientOptions) {
    this.webhookKey = options.webhookKey;
    this.logger = options.logger;
  }

  async trigger(event: string): Promise<void> {
    const url = `${IFTTT_BASE_URL}/${event}/with/key/${this.webhookKey}`;

    this.logger.info("Triggering IFTTT webhook", { event });

    let response: Response;
    try {
      response = await fetch(url, { method: "POST" });
    } catch (error) {
      // Network-level failure: worth retrying.
      throw new ProviderError(
        "IFTTT",
        `Webhook request failed for ${event}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (!response.ok) {
      const message = `Webhook trigger failed: ${response.status} for ${event}`;
      if (isTerminalStatus(response.status)) {
        throw new TerminalProviderError("IFTTT", message);
      }
      throw new ProviderError("IFTTT", message);
    }

    this.logger.info("IFTTT webhook triggered successfully", { event });
  }
}
