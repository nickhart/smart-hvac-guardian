export interface YoLinkTokenResponse {
  code: string;
  msg: string;
  data: {
    access_token: string;
    expires_in: number;
    token_type: string;
  };
}

export interface YoLinkDeviceStateResponse {
  code: string;
  msg: string;
  data: {
    state: {
      state: string; // "open" | "closed" | ...
      battery: number;
      alertInterval: number;
    };
  };
}
