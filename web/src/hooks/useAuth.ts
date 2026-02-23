import { useState, useEffect, useCallback } from "react";
import * as api from "../lib/api";

interface AuthState {
  loading: boolean;
  authenticated: boolean;
  email?: string;
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    loading: true,
    authenticated: false,
  });

  useEffect(() => {
    api
      .checkSession()
      .then((res) =>
        setState({
          loading: false,
          authenticated: res.authenticated,
          email: res.email,
        }),
      )
      .catch(() => setState({ loading: false, authenticated: false }));
  }, []);

  const handleLogout = useCallback(async () => {
    await api.logout();
    setState({ loading: false, authenticated: false });
  }, []);

  return { ...state, logout: handleLogout };
}
