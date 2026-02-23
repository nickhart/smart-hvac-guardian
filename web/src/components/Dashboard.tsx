import { useState, useEffect, useCallback, useRef } from "react";
import { getCheckState, setUnitDelay, type CheckStateResponse } from "../lib/api";
import { SensorCard } from "./SensorCard";
import { HvacUnitCard } from "./HvacUnitCard";
import { SystemToggle } from "./SystemToggle";

interface DashboardProps {
  onLogout: () => void;
  siteName: string;
}

export function Dashboard({ onLogout, siteName }: DashboardProps) {
  const [state, setState] = useState<CheckStateResponse | null>(null);
  const [error, setError] = useState("");
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await getCheckState();
      if (Date.now() < toggleGraceRef.current) {
        setState((prev) => (prev ? { ...data, systemEnabled: prev.systemEnabled } : data));
      } else {
        setState(data);
      }
      setLastUpdate(new Date());
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load state");
    }
  }, []);

  const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const toggleGraceRef = useRef<number>(0);

  const startPolling = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(refresh, 10_000);
  }, [refresh]);

  useEffect(() => {
    refresh();
    startPolling();
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [refresh, startPolling]);

  const handleDelayChange = useCallback(
    async (unitId: string, delaySeconds: number) => {
      // Optimistic update
      setState((prev) =>
        prev ? { ...prev, unitDelays: { ...prev.unitDelays, [unitId]: delaySeconds } } : prev,
      );
      try {
        await setUnitDelay(unitId, delaySeconds);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to update delay");
        await refresh();
      }
    },
    [refresh],
  );

  if (!state) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        {error ? (
          <p className="text-red-600">{error}</p>
        ) : (
          <p className="text-gray-500">Loading...</p>
        )}
      </div>
    );
  }

  const sensorIds = Object.keys(state.sensorStates);
  const allUnitIds = [...state.exposedUnits, ...state.unexposedUnits];
  const exposedSet = new Set(state.exposedUnits);
  const timerSet = new Set(state.activeTimers);
  const offlineSet = new Set(state.offlineSensors);

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <header className="flex items-center justify-between mb-6">
        <h1 className="text-lg font-semibold">{siteName}</h1>
        <div className="flex items-center gap-4">
          <SystemToggle
            enabled={state.systemEnabled}
            onToggle={(enabled) => {
              setState((prev) => (prev ? { ...prev, systemEnabled: enabled } : prev));
              toggleGraceRef.current = Date.now() + 15_000;
              startPolling();
            }}
          />
          <button onClick={onLogout} className="text-sm text-gray-500 hover:text-gray-700">
            Logout
          </button>
        </div>
      </header>

      {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

      {!state.systemEnabled && (
        <div className="bg-yellow-50 border border-yellow-300 rounded-lg p-3 mb-4 text-sm text-yellow-800">
          System is disabled. Auto-shutoffs are paused.
        </div>
      )}

      <section className="mb-6">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
          Sensors
        </h2>
        <div className="grid grid-cols-2 gap-2">
          {sensorIds.map((id) => (
            <SensorCard
              key={id}
              sensorId={id}
              state={state.sensorStates[id]}
              isOffline={offlineSet.has(id)}
              displayName={state.sensorNames?.[id]}
            />
          ))}
        </div>
      </section>

      <section className="mb-6">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
          HVAC Units
        </h2>
        <div className="grid grid-cols-2 gap-2">
          {allUnitIds.map((id) => (
            <HvacUnitCard
              key={id}
              unitId={id}
              isExposed={exposedSet.has(id)}
              hasActiveTimer={timerSet.has(id)}
              displayName={state.unitNames?.[id]}
              delaySeconds={state.unitDelays?.[id]}
              onDelayChange={handleDelayChange}
            />
          ))}
        </div>
      </section>

      {lastUpdate && (
        <p className="text-xs text-gray-400 text-center">
          Updated {lastUpdate.toLocaleTimeString()}
        </p>
      )}
    </div>
  );
}
