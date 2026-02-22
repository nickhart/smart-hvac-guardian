import { useState, useEffect, useCallback } from "react";
import { getCheckState, type CheckStateResponse } from "../lib/api";
import { SensorCard } from "./SensorCard";
import { HvacUnitCard } from "./HvacUnitCard";
import { SystemToggle } from "./SystemToggle";

interface DashboardProps {
  onLogout: () => void;
}

export function Dashboard({ onLogout }: DashboardProps) {
  const [state, setState] = useState<CheckStateResponse | null>(null);
  const [error, setError] = useState("");
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await getCheckState();
      setState(data);
      setLastUpdate(new Date());
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load state");
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 10_000);
    return () => clearInterval(interval);
  }, [refresh]);

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
        <h1 className="text-lg font-semibold">HVAC Guardian</h1>
        <div className="flex items-center gap-4">
          <SystemToggle
            enabled={state.systemEnabled}
            onToggle={(enabled) => setState({ ...state, systemEnabled: enabled })}
          />
          <button
            onClick={onLogout}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            Logout
          </button>
        </div>
      </header>

      {error && (
        <p className="text-red-600 text-sm mb-4">{error}</p>
      )}

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
