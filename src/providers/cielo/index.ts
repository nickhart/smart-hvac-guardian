import type { HVACProvider } from "../types.js";
import { IFTTTClient } from "./client.js";

export class CieloIFTTTProvider implements HVACProvider {
  private readonly client: IFTTTClient;

  constructor(client: IFTTTClient) {
    this.client = client;
  }

  async turnOff(iftttEvent: string): Promise<void> {
    await this.client.trigger(iftttEvent);
  }
}

export { IFTTTClient } from "./client.js";
