export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export class ProviderError extends Error {
  public readonly provider: string;

  constructor(provider: string, message: string) {
    super(`[${provider}] ${message}`);
    this.name = "ProviderError";
    this.provider = provider;
  }
}

export class WebhookValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookValidationError";
  }
}

/**
 * A provider failure that retrying cannot fix — a bad webhook key, an unknown
 * event name, a malformed request. Callers should stop rather than retry.
 */
export class TerminalProviderError extends ProviderError {
  constructor(provider: string, message: string) {
    super(provider, message);
    this.name = "TerminalProviderError";
  }
}

/**
 * The provider answered, and says it has never heard of this device.
 *
 * Terminal, and a different kind of problem from the provider being down: a
 * configured sensor that does not exist in the account is a configuration
 * error — a device removed, replaced, or a mistyped ID — and no amount of
 * retrying or waiting will fix it. Structural config validation cannot catch
 * this, because the config is perfectly well-formed; only the provider knows
 * the ID is wrong.
 */
export class UnknownDeviceError extends TerminalProviderError {
  public readonly deviceId: string;

  constructor(provider: string, deviceId: string) {
    super(provider, `Device ${deviceId} not found in device list`);
    this.name = "UnknownDeviceError";
    this.deviceId = deviceId;
  }
}

/**
 * Raised instead of calling a provider whose circuit breaker is open. Not a
 * failure of this request — the call was deliberately skipped.
 */
export class CircuitOpenError extends Error {
  public readonly circuit: string;

  constructor(circuit: string) {
    super(`Circuit "${circuit}" is open — call skipped`);
    this.name = "CircuitOpenError";
    this.circuit = circuit;
  }
}
