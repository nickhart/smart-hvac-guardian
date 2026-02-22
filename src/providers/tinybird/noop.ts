import type { AnalyticsProvider } from "../types.js";

export class NoopAnalyticsProvider implements AnalyticsProvider {
  async trackSensorEvent(): Promise<void> {}
  async trackHvacCommand(): Promise<void> {}
  async trackHvacStateEvent(): Promise<void> {}
}
