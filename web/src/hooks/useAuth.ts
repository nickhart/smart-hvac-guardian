import { useState, useEffect, useCallback } from "react";
import * as api from "../lib/api";

interface AuthState {
  loading: boolean;
  authenticated: boolean;
  email?: string;
  siteName: string;
  logoUrl?: string;
  primaryColor?: string;
  tenantId?: string;
  tenantStatus?: "onboarding" | "active" | "suspended";
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    loading: true,
    authenticated: false,
    siteName: "HVAC Guardian",
  });

  const checkAuth = useCallback(() => {
    api
      .checkSession()
      .then((res) => {
        const siteName = res.siteName ?? "HVAC Guardian";
        document.title = siteName;
        setState({
          loading: false,
          authenticated: res.authenticated,
          email: res.email,
          siteName,
          logoUrl: res.logoUrl,
          primaryColor: res.primaryColor,
          tenantId: res.tenantId,
          tenantStatus: res.tenantStatus,
        });
      })
      .catch(() => setState({ loading: false, authenticated: false, siteName: "HVAC Guardian" }));
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const handleLogout = useCallback(async () => {
    await api.logout();
    setState((prev) => ({
      ...prev,
      loading: false,
      authenticated: false,
      tenantStatus: undefined,
    }));
  }, []);

  return { ...state, logout: handleLogout, refreshAuth: checkAuth };
}
