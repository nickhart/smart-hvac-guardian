import { useState, useEffect, useCallback } from "react";
import * as api from "../lib/api";

interface AuthState {
  loading: boolean;
  authenticated: boolean;
  email?: string;
  siteName: string;
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    loading: true,
    authenticated: false,
    siteName: "HVAC Guardian",
  });

  useEffect(() => {
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
        });
      })
      .catch(() => setState({ loading: false, authenticated: false, siteName: "HVAC Guardian" }));
  }, []);

  const handleLogout = useCallback(async () => {
    await api.logout();
    setState((prev) => ({ ...prev, loading: false, authenticated: false }));
  }, []);

  return { ...state, logout: handleLogout };
}
