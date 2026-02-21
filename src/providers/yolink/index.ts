import type { SensorProvider, SensorState } from "../types.js";
import { YoLinkClient } from "./client.js";
import type { Logger } from "../../utils/logger.js";

export class YoLinkSensorProvider implements SensorProvider {
  private readonly client: YoLinkClient;
  private readonly logger: Logger;

  constructor(client: YoLinkClient, logger: Logger) {
    this.client = client;
    this.logger = logger;
  }

  async getState(sensorId: string): Promise<SensorState> {
    const rawState = await this.client.getDeviceState(sensorId);

    this.logger.info("YoLink sensor state", { sensorId, rawState });

    switch (rawState) {
      case "open":
        return "open";
      case "closed":
        return "closed";
      default:
        this.logger.warn("Unknown YoLink sensor state", { sensorId, rawState });
        return "unknown";
    }
  }
}

export { YoLinkClient } from "./client.js";
