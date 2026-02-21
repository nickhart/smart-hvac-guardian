import { Client } from "@upstash/qstash";
import type { SchedulerProvider } from "../types.js";
import { ProviderError } from "../../utils/errors.js";
import type { Logger } from "../../utils/logger.js";

interface QStashSchedulerOptions {
  token: string;
  checkStateUrl: string;
  logger: Logger;
}

export class QStashScheduler implements SchedulerProvider {
  private readonly client: Client;
  private readonly checkStateUrl: string;
  private readonly logger: Logger;

  constructor(options: QStashSchedulerOptions) {
    this.client = new Client({ token: options.token });
    this.checkStateUrl = options.checkStateUrl;
    this.logger = options.logger;
  }

  async scheduleDelayedCheck(sensorId: string, delaySeconds: number): Promise<void> {
    this.logger.info("Scheduling delayed state check", { sensorId, delaySeconds });

    try {
      await this.client.publishJSON({
        url: this.checkStateUrl,
        body: { sensorId },
        delay: delaySeconds,
      });

      this.logger.info("Delayed check scheduled successfully", { sensorId });
    } catch (error) {
      throw new ProviderError(
        "QStash",
        `Failed to schedule check: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
