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
