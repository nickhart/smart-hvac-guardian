import type { AnalyticsProvider, HVACProvider } from "../types.js";
import { IFTTTClient } from "./client.js";
import { withCircuitBreaker } from "../../utils/circuit-breaker.js";
import type { CircuitStore } from "../../utils/circuit-breaker.js";
import { CircuitOpenError, TerminalProviderError } from "../../utils/errors.js";
import type { Logger } from "../../utils/logger.js";

export const IFTTT_CIRCUIT = "ifttt";

interface CieloIFTTTProviderOptions {
  circuitStore?: CircuitStore;
  analytics?: AnalyticsProvider;
  logger?: Logger;
}

export class CieloIFTTTProvider implements HVACProvider {
  private readonly client: IFTTTClient;
  private readonly circuitStore?: CircuitStore;
  private readonly analytics?: AnalyticsProvider;
  private readonly logger?: Logger;

  constructor(client: IFTTTClient, options?: CieloIFTTTProviderOptions) {
    this.client = client;
    this.circuitStore = options?.circuitStore;
    this.analytics = options?.analytics;
    this.logger = options?.logger;
  }

  async turnOff(iftttEvent: string): Promise<void> {
    const started = Date.now();

    const run = async () => {
      if (!this.circuitStore) return this.client.trigger(iftttEvent);
      return withCircuitBreaker(
        this.circuitStore,
        IFTTT_CIRCUIT,
        () => this.client.trigger(iftttEvent),
        this.logger,
      );
    };

    try {
      await run();
      await this.track("ok", iftttEvent, started);
    } catch (error) {
      const outcome = error instanceof CircuitOpenError ? "skipped_circuit_open" : "failed";
      await this.track(
        outcome,
        iftttEvent,
        started,
        error instanceof Error ? error.message : String(error),
        error instanceof TerminalProviderError,
      );
      throw error;
    }
  }

  private async track(
    outcome: "ok" | "failed" | "skipped_circuit_open",
    iftttEvent: string,
    started: number,
    errorMessage?: string,
    terminal?: boolean,
  ): Promise<void> {
    if (!this.analytics) return;
    await this.analytics.trackProviderEvent({
      provider: "ifttt",
      operation: `trigger:${iftttEvent}`,
      outcome,
      durationMs: Date.now() - started,
      errorMessage,
      terminal,
    });
  }
}

export { IFTTTClient } from "./client.js";
