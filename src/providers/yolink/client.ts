import type { YoLinkTokenResponse, YoLinkDeviceStateResponse } from "./types.js";
import { ProviderError } from "../../utils/errors.js";
import type { Logger } from "../../utils/logger.js";

const TOKEN_URL = "https://api.yosmart.com/open/yolink/token";

interface YoLinkClientOptions {
  baseUrl: string;
  uaCid: string;
  secretKey: string;
  logger: Logger;
}

export class YoLinkClient {
  private readonly baseUrl: string;
  private readonly uaCid: string;
  private readonly secretKey: string;
  private readonly logger: Logger;
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;

  constructor(options: YoLinkClientOptions) {
    this.baseUrl = options.baseUrl;
    this.uaCid = options.uaCid;
    this.secretKey = options.secretKey;
    this.logger = options.logger;
  }

  private async getToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt) {
      return this.accessToken;
    }

    this.logger.info("Fetching new YoLink access token");

    const params = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.uaCid,
      client_secret: this.secretKey,
    });

    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    if (!response.ok) {
      throw new ProviderError("YoLink", `Token request failed: ${response.status}`);
    }

    const data = (await response.json()) as YoLinkTokenResponse;
    if (data.code !== "000000") {
      throw new ProviderError("YoLink", `Token error: ${data.msg}`);
    }

    this.accessToken = data.data.access_token;
    // Expire 60s early to avoid edge cases
    this.tokenExpiresAt = Date.now() + (data.data.expires_in - 60) * 1000;

    return this.accessToken;
  }

  async getDeviceState(deviceId: string): Promise<string> {
    const token = await this.getToken();

    this.logger.info("Querying YoLink device state", { deviceId });

    const response = await fetch(this.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        method: "DoorSensor.getState",
        targetDevice: deviceId,
      }),
    });

    if (!response.ok) {
      throw new ProviderError("YoLink", `Device state request failed: ${response.status}`);
    }

    const data = (await response.json()) as YoLinkDeviceStateResponse;
    if (data.code !== "000000") {
      throw new ProviderError("YoLink", `Device state error: ${data.msg}`);
    }

    return data.data.state.state;
  }
}
