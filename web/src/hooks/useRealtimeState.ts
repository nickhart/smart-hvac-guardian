import { useState, useEffect, useCallback, useRef } from "react";
import { getCheckState, type CheckStateResponse } from "../lib/api";

const SSE_EVENT_TYPES = [
  "sensor-state",
  "timer-set",
  "timer-deleted",
  "timer-expired",
  "timer-scheduled",
  "timer-fired",
  "timer-cancelled",
  "hvac-turn-off",
  "hvac-state",
  "system-enabled",
  "unit-delay",
];

function getPollingInterval(state: CheckStateResponse | null, tabVisible: boolean): number {
  if (!tabVisible) return 15_000;
  if (state && state.activeTimers.length > 0) return 3_000;
  return 5_000;
}

export function useRealtimeState() {
  const [state, setState] = useState<CheckStateResponse | null>(null);
  const [error, setError] = useState("");
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const toggleGraceRef = useRef<number>(0);
  const quietUntilRef = useRef<number>(0);
  const quietTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const sseConnectedRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    if (Date.now() < quietUntilRef.current) return; // suppress during quiet period
    try {
      const data = await getCheckState();
      if (!mountedRef.current) return;
      if (Date.now() < toggleGraceRef.current) {
        setState((prev) => (prev ? { ...data, systemEnabled: prev.systemEnabled } : data));
      } else {
        setState(data);
      }
      setLastUpdate(new Date());
      setError("");
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to load state");
    }
  }, []);

  const debouncedRefresh = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(refresh, 100);
  }, [refresh]);

  const setOptimisticState = useCallback(
    (updater: (prev: CheckStateResponse | null) => CheckStateResponse | null) => {
      setState(updater);
    },
    [],
  );

  const setToggleGrace = useCallback(() => {
    toggleGraceRef.current = Date.now() + 15_000;
    // Suppress refreshes for 2s so the backend can settle before we poll
    quietUntilRef.current = Date.now() + 2_000;
    if (quietTimerRef.current) clearTimeout(quietTimerRef.current);
    quietTimerRef.current = setTimeout(refresh, 2_000);
  }, [refresh]);

  // Adaptive polling
  useEffect(() => {
    const startPolling = () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (sseConnectedRef.current) return; // SSE handles updates

      const interval = getPollingInterval(state, !document.hidden);
      intervalRef.current = setInterval(refresh, interval);
    };

    startPolling();

    const onVisibility = () => startPolling();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [state, refresh]);

  // SSE connection (dev only)
  useEffect(() => {
    if (!import.meta.env.DEV) return;

    let es: EventSource | null = null;
    let failCount = 0;
    const MAX_FAILURES = 5;

    const connect = () => {
      es = new EventSource("/api/events");

      es.onopen = () => {
        failCount = 0;
        sseConnectedRef.current = true;
        // Stop polling since SSE is active
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = undefined;
        }
      };

      es.onerror = () => {
        sseConnectedRef.current = false;
        failCount++;
        if (failCount >= MAX_FAILURES) {
          es?.close();
          es = null;
          // Polling will resume via the polling effect's dependency on state
        }
      };

      for (const type of SSE_EVENT_TYPES) {
        es.addEventListener(type, () => debouncedRefresh());
      }
    };

    connect();

    return () => {
      sseConnectedRef.current = false;
      es?.close();
      es = null;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [debouncedRefresh]);

  // Initial fetch
  useEffect(() => {
    mountedRef.current = true;
    refresh();
    return () => {
      mountedRef.current = false;
      if (quietTimerRef.current) clearTimeout(quietTimerRef.current);
    };
  }, [refresh]);

  const sseActive = import.meta.env.DEV && sseConnectedRef.current;

  return { state, error, lastUpdate, refresh, setOptimisticState, setToggleGrace, sseActive };
}
