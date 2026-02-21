export interface YoLinkTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
}

export interface YoLinkDeviceListResponse {
  code: string;
  msg?: string;
  desc?: string;
  data: {
    devices: Array<{
      deviceId: string;
      deviceUDID: string;
      name: string;
      token: string;
      type: string;
    }>;
  };
}

export interface YoLinkDeviceStateResponse {
  code: string;
  msg?: string;
  desc?: string;
  data: {
    state: {
      state: string; // "open" | "closed" | ...
      battery: number;
      alertInterval: number;
    };
  };
}
