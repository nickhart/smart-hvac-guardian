import { ProviderError } from "../../utils/errors.js";
import type { Logger } from "../../utils/logger.js";

const IFTTT_BASE_URL = "https://maker.ifttt.com/trigger";

interface IFTTTClientOptions {
  webhookKey: string;
  logger: Logger;
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

    const response = await fetch(url, { method: "POST" });

    if (!response.ok) {
      throw new ProviderError("IFTTT", `Webhook trigger failed: ${response.status} for ${event}`);
    }

    this.logger.info("IFTTT webhook triggered successfully", { event });
  }
}
