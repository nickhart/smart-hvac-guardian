import { useState, useCallback } from "react";
import { setUnitDelay } from "../lib/api";
import { useRealtimeState } from "../hooks/useRealtimeState";
import { SensorCard } from "./SensorCard";
import { HvacUnitCard } from "./HvacUnitCard";
import { SystemToggle } from "./SystemToggle";
import { Settings } from "./Settings";

interface DashboardProps {
  onLogout: () => void;
  siteName: string;
  logoUrl?: string;
}

export function Dashboard({ onLogout, siteName, logoUrl }: DashboardProps) {
  const [view, setView] = useState<"dashboard" | "settings">("dashboard");
  const { state, error, lastUpdate, refresh, setOptimisticState, setToggleGrace, sseActive } =
    useRealtimeState();
  const [mutationError, setMutationError] = useState("");

  const handleDelayChange = useCallback(
    async (unitId: string, delaySeconds: number) => {
      setOptimisticState((prev) =>
        prev ? { ...prev, unitDelays: { ...prev.unitDelays, [unitId]: delaySeconds } } : prev,
      );
      try {
        await setUnitDelay(unitId, delaySeconds);
        await refresh();
        setMutationError("");
      } catch (err) {
        setMutationError(err instanceof Error ? err.message : "Failed to update delay");
        await refresh();
      }
    },
    [refresh, setOptimisticState],
  );

  if (view === "settings") {
    return <Settings onBack={() => setView("dashboard")} />;
  }

  if (!state) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-6">
        {error ? (
          <div>
            <p className="text-red-600 mb-4">{error}</p>
            <button
              onClick={() => setView("settings")}
              className="text-sm text-primary-600 hover:text-primary-800"
            >
              Open Settings to fix config
            </button>
          </div>
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
  const displayError = error || mutationError;

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <header className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          {logoUrl && <img src={logoUrl} alt={siteName} className="h-6" />}
          <h1 className="text-lg font-semibold">{siteName}</h1>
        </div>
        <div className="flex items-center gap-4">
          <SystemToggle
            enabled={state.systemEnabled}
            onToggle={(enabled) => {
              setOptimisticState((prev) => (prev ? { ...prev, systemEnabled: enabled } : prev));
              setToggleGrace();
            }}
          />
          <button
            onClick={() => setView("settings")}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            Settings
          </button>
          <button onClick={onLogout} className="text-sm text-gray-500 hover:text-gray-700">
            Logout
          </button>
        </div>
      </header>

      {displayError && <p className="text-red-600 text-sm mb-4">{displayError}</p>}

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
          {sseActive && " · live"}
        </p>
      )}
    </div>
  );
}
