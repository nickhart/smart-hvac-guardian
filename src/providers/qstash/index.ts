import { Client } from "@upstash/qstash";
import type { SchedulerProvider } from "../types.js";
import { ProviderError } from "../../utils/errors.js";
import type { Logger } from "../../utils/logger.js";

interface QStashSchedulerOptions {
  token: string;
  checkStateUrl: string;
  turnOffUrl: string;
  logger: Logger;
}

export class QStashScheduler implements SchedulerProvider {
  private readonly client: Client;
  private readonly checkStateUrl: string;
  private readonly turnOffUrl: string;
  private readonly logger: Logger;

  constructor(options: QStashSchedulerOptions) {
    this.client = new Client({ token: options.token });
    this.checkStateUrl = options.checkStateUrl;
    this.turnOffUrl = options.turnOffUrl;
    this.logger = options.logger;
  }

  async scheduleDelayedCheck(
    sensorId: string,
    delaySeconds: number,
    deduplicationId?: string,
  ): Promise<void> {
    this.logger.info("Scheduling delayed state check", { sensorId, delaySeconds, deduplicationId });

    try {
      await this.client.publishJSON({
        url: this.checkStateUrl,
        body: { sensorId },
        delay: delaySeconds,
        ...(deduplicationId ? { deduplicationId } : {}),
      });

      this.logger.info("Delayed check scheduled successfully", { sensorId, deduplicationId });
    } catch (error) {
      throw new ProviderError(
        "QStash",
        `Failed to schedule check: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async scheduleTurnOff(deduplicationId: string): Promise<void> {
    this.logger.info("Scheduling HVAC turn-off", { deduplicationId });

    try {
      await this.client.publishJSON({
        url: this.turnOffUrl,
        body: {},
        deduplicationId,
      });

      this.logger.info("HVAC turn-off scheduled successfully", { deduplicationId });
    } catch (error) {
      throw new ProviderError(
        "QStash",
        `Failed to schedule turn-off: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
