import { useState, useEffect } from "react";
import * as api from "../../lib/api";

interface StepProps {
  data: Record<string, unknown>;
  allStepData: Record<string, Record<string, unknown>>;
  onSave: (data: Record<string, unknown>) => void;
  saving: boolean;
}

interface SensorEntry {
  id: string;
  name: string;
  delay: number;
  defaultState: "open" | "closed" | "";
}

export function Step3Sensors({ data, onSave }: StepProps) {
  const [sensors, setSensors] = useState<SensorEntry[]>(() => {
    const delays = (data.sensorDelays ?? {}) as Record<string, number>;
    const names = (data.sensorNames ?? {}) as Record<string, string>;
    const defaults = (data.sensorDefaults ?? {}) as Record<string, string>;
    const entries = Object.entries(delays).map(([id, delay]) => ({
      id,
      name: names[id] ?? "",
      delay,
      defaultState: (defaults[id] ?? "") as SensorEntry["defaultState"],
    }));
    return entries.length > 0 ? entries : [];
  });
  const [discovering, setDiscovering] = useState(false);

  async function handleDiscover() {
    setDiscovering(true);
    try {
      const res = await api.discoverYoLinkDevices();
      const discovered: SensorEntry[] = res.devices.map((d) => ({
        id: d.deviceId,
        name: d.name,
        delay: 300,
        defaultState: "" as const,
      }));
      // Merge with existing (keep existing delays/names if IDs match)
      const existingMap = new Map(sensors.map((s) => [s.id, s]));
      const merged = discovered.map((d) => existingMap.get(d.id) ?? d);
      setSensors(merged);
    } catch {
      // Error handled by parent
    } finally {
      setDiscovering(false);
    }
  }

  function addSensor() {
    setSensors((prev) => [...prev, { id: "", name: "", delay: 300, defaultState: "" }]);
  }

  function removeSensor(index: number) {
    setSensors((prev) => prev.filter((_, i) => i !== index));
  }

  function updateSensor(index: number, field: keyof SensorEntry, value: string | number) {
    setSensors((prev) => prev.map((s, i) => (i === index ? { ...s, [field]: value } : s)));
  }

  // Suppress unused warning
  useEffect(() => {}, []);

  return (
    <div>
      <h2 className="text-lg font-semibold mb-2">Sensors</h2>
      <p className="text-sm text-gray-600 mb-4">
        Add your door/window sensors. You can auto-discover from YoLink or add manually.
      </p>

      <button
        type="button"
        onClick={handleDiscover}
        disabled={discovering}
        className="text-sm bg-blue-50 border border-blue-200 px-3 py-1.5 rounded hover:bg-blue-100 disabled:opacity-50 mb-4"
      >
        {discovering ? "Discovering..." : "Auto-discover from YoLink"}
      </button>

      <form
        data-step-form
        onSubmit={(e) => {
          e.preventDefault();
          const sensorDelays: Record<string, number> = {};
          const sensorNames: Record<string, string> = {};
          const sensorDefaults: Record<string, string> = {};
          for (const s of sensors) {
            const id = s.id.trim();
            if (!id) continue;
            sensorDelays[id] = s.delay;
            if (s.name) sensorNames[id] = s.name.trim();
            if (s.defaultState) sensorDefaults[id] = s.defaultState;
          }
          onSave({ sensorDelays, sensorNames, sensorDefaults });
        }}
      >
        <div className="space-y-3">
          {sensors.map((sensor, i) => (
            <div key={i} className="border rounded p-3 space-y-2">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={sensor.id}
                  onChange={(e) => updateSensor(i, "id", e.target.value)}
                  placeholder="Sensor ID"
                  className="flex-1 border rounded px-2 py-1 text-sm"
                  required
                />
                <input
                  type="text"
                  value={sensor.name}
                  onChange={(e) => updateSensor(i, "name", e.target.value)}
                  placeholder="Display name"
                  className="flex-1 border rounded px-2 py-1 text-sm"
                />
              </div>
              <div className="flex gap-2 items-center">
                <label className="text-xs text-gray-500">Delay (s):</label>
                <input
                  type="number"
                  value={sensor.delay}
                  onChange={(e) => updateSensor(i, "delay", parseInt(e.target.value) || 300)}
                  className="w-20 border rounded px-2 py-1 text-sm"
                  min={0}
                />
                <label className="text-xs text-gray-500 ml-2">Default:</label>
                <select
                  value={sensor.defaultState}
                  onChange={(e) => updateSensor(i, "defaultState", e.target.value)}
                  className="border rounded px-2 py-1 text-sm"
                >
                  <option value="">None</option>
                  <option value="closed">Closed</option>
                  <option value="open">Open</option>
                </select>
                <button
                  type="button"
                  onClick={() => removeSensor(i)}
                  className="text-red-500 text-sm ml-auto hover:text-red-700"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={addSensor}
          className="mt-3 text-sm text-blue-600 hover:text-blue-800"
        >
          + Add sensor manually
        </button>
      </form>
    </div>
  );
}
