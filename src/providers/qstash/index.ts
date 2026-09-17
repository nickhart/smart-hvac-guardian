import { Client } from "@upstash/qstash";
import type { SchedulerProvider } from "../types.js";
import { ProviderError } from "../../utils/errors.js";
import type { Logger } from "../../utils/logger.js";

/**
 * QStash retries a non-2xx endpoint up to 3 times by default, so one logical
 * turn-off could become four IFTTT invocations — and four failure
 * notifications — during an outage. One retry covers a transient blip without
 * amplifying a sustained one.
 */
const DELIVERY_RETRIES = 1;

interface QStashSchedulerOptions {
  token: string;
  checkStateUrl: string;
  turnOffUrl: string;
  logger: Logger;
  tenantId?: string;
}

export class QStashScheduler implements SchedulerProvider {
  private readonly client: Client;
  private readonly checkStateUrl: string;
  private readonly turnOffUrl: string;
  private readonly logger: Logger;
  private readonly tenantId?: string;

  constructor(options: QStashSchedulerOptions) {
    this.client = new Client({ token: options.token });
    this.checkStateUrl = options.checkStateUrl;
    this.turnOffUrl = options.turnOffUrl;
    this.logger = options.logger;
    this.tenantId = options.tenantId;
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
        body: { sensorId, ...(this.tenantId ? { tenantId: this.tenantId } : {}) },
        delay: delaySeconds,
        retries: DELIVERY_RETRIES,
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
        body: { ...(this.tenantId ? { tenantId: this.tenantId } : {}) },
        deduplicationId,
        retries: DELIVERY_RETRIES,
      });

      this.logger.info("HVAC turn-off scheduled successfully", { deduplicationId });
    } catch (error) {
      throw new ProviderError(
        "QStash",
        `Failed to schedule turn-off: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async scheduleUnitTurnOff(
    hvacUnitId: string,
    cancellationToken: string,
    delaySeconds: number,
    deduplicationId: string,
  ): Promise<void> {
    // Scope dedup IDs to tenant
    const scopedDedupId = this.tenantId ? `${this.tenantId}-${deduplicationId}` : deduplicationId;

    this.logger.info("Scheduling per-unit HVAC turn-off", {
      hvacUnitId,
      cancellationToken,
      delaySeconds,
      deduplicationId: scopedDedupId,
      tenantId: this.tenantId,
    });

    try {
      await this.client.publishJSON({
        url: this.turnOffUrl,
        body: {
          hvacUnitId,
          cancellationToken,
          ...(this.tenantId ? { tenantId: this.tenantId } : {}),
        },
        delay: delaySeconds,
        deduplicationId: scopedDedupId,
        retries: DELIVERY_RETRIES,
      });

      this.logger.info("Per-unit HVAC turn-off scheduled successfully", {
        hvacUnitId,
        deduplicationId: scopedDedupId,
      });
    } catch (error) {
      throw new ProviderError(
        "QStash",
        `Failed to schedule unit turn-off: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
