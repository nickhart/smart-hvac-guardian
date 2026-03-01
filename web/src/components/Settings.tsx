import { useState, useEffect } from "react";
import * as api from "../lib/api";

interface HvacUnit {
  name: string;
  iftttEvent: string;
  delaySeconds: number;
}

interface InteriorDoor {
  id: string;
  connectsTo: string;
}

interface ZoneConfig {
  minisplits: string[];
  exteriorOpenings: string[];
  interiorDoors: InteriorDoor[];
}

interface AppConfig {
  hvacUnits: Record<string, HvacUnit>;
  sensorDelays: Record<string, number>;
  sensorNames: Record<string, string>;
  sensorDefaults: Record<string, string>;
  zones: Record<string, ZoneConfig>;
  turnOffUrl: string;
  yolink: { baseUrl: string };
}

function omitKey<V>(record: Record<string, V>, key: string): Record<string, V> {
  return Object.fromEntries(Object.entries(record).filter(([k]) => k !== key));
}

interface SettingsProps {
  onBack: () => void;
}

export function Settings({ onBack }: SettingsProps) {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  useEffect(() => {
    api
      .getConfig()
      .then((res) => {
        setConfig(res.config as unknown as AppConfig);
        if (!res.valid && res.errors) {
          setValidationErrors(res.errors.formErrors);
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load config"))
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    if (!config) return;
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      await api.updateConfig(config as unknown as Record<string, unknown>);
      setSuccess("Settings saved successfully.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  // --- HVAC Units helpers ---
  function updateHvacUnit(unitId: string, field: keyof HvacUnit, value: string | number) {
    if (!config) return;
    setConfig({
      ...config,
      hvacUnits: {
        ...config.hvacUnits,
        [unitId]: { ...config.hvacUnits[unitId], [field]: value },
      },
    });
  }

  function addHvacUnit() {
    if (!config) return;
    const id = `unit_${Object.keys(config.hvacUnits).length + 1}`;
    setConfig({
      ...config,
      hvacUnits: {
        ...config.hvacUnits,
        [id]: { name: id, iftttEvent: `turn_off_${id}`, delaySeconds: 300 },
      },
    });
  }

  function removeHvacUnit(unitId: string) {
    if (!config) return;
    setConfig({ ...config, hvacUnits: omitKey(config.hvacUnits, unitId) });
  }

  function renameHvacUnitId(oldId: string, newId: string) {
    if (!config || !newId || newId === oldId) return;
    const unit = config.hvacUnits[oldId];
    const rest = omitKey(config.hvacUnits, oldId);
    setConfig({
      ...config,
      hvacUnits: { ...rest, [newId]: { ...unit, iftttEvent: `turn_off_${newId}` } },
    });
  }

  // --- Sensor helpers ---
  function updateSensorDelay(sensorId: string, delay: number) {
    if (!config) return;
    setConfig({
      ...config,
      sensorDelays: { ...config.sensorDelays, [sensorId]: delay },
    });
  }

  function updateSensorName(sensorId: string, name: string) {
    if (!config) return;
    const sensorNames = { ...config.sensorNames };
    if (name) {
      sensorNames[sensorId] = name;
    } else {
      delete sensorNames[sensorId];
    }
    setConfig({ ...config, sensorNames });
  }

  function updateSensorDefault(sensorId: string, defaultState: string) {
    if (!config) return;
    const sensorDefaults = { ...config.sensorDefaults };
    if (defaultState) {
      sensorDefaults[sensorId] = defaultState;
    } else {
      delete sensorDefaults[sensorId];
    }
    setConfig({ ...config, sensorDefaults });
  }

  function addSensor() {
    if (!config) return;
    const id = `sensor_${Object.keys(config.sensorDelays).length + 1}`;
    setConfig({
      ...config,
      sensorDelays: { ...config.sensorDelays, [id]: 300 },
    });
  }

  function removeSensor(sensorId: string) {
    if (!config) return;
    setConfig({
      ...config,
      sensorDelays: omitKey(config.sensorDelays, sensorId),
      sensorNames: omitKey(config.sensorNames, sensorId),
      sensorDefaults: omitKey(config.sensorDefaults, sensorId),
    });
  }

  function renameSensorId(oldId: string, newId: string) {
    if (!config || !newId || newId === oldId) return;
    const delay = config.sensorDelays[oldId];
    const name = config.sensorNames[oldId];
    const def = config.sensorDefaults[oldId];
    const restDelays = omitKey(config.sensorDelays, oldId);
    const restNames = omitKey(config.sensorNames, oldId);
    const restDefaults = omitKey(config.sensorDefaults, oldId);
    const sensorDelays = { ...restDelays, [newId]: delay };
    const sensorNames = name ? { ...restNames, [newId]: name } : restNames;
    const sensorDefaults = def ? { ...restDefaults, [newId]: def } : restDefaults;
    setConfig({ ...config, sensorDelays, sensorNames, sensorDefaults });
  }

  // --- Zone helpers ---
  function toggleZoneItem(
    zoneId: string,
    field: "minisplits" | "exteriorOpenings",
    itemId: string,
  ) {
    if (!config) return;
    const zone = config.zones[zoneId];
    const current = zone[field];
    const has = current.includes(itemId);
    setConfig({
      ...config,
      zones: {
        ...config.zones,
        [zoneId]: {
          ...zone,
          [field]: has ? current.filter((s) => s !== itemId) : [...current, itemId],
        },
      },
    });
  }

  function addZone() {
    if (!config) return;
    const id = `zone_${Object.keys(config.zones).length + 1}`;
    setConfig({
      ...config,
      zones: {
        ...config.zones,
        [id]: { minisplits: [], exteriorOpenings: [], interiorDoors: [] },
      },
    });
  }

  function removeZone(zoneId: string) {
    if (!config) return;
    setConfig({ ...config, zones: omitKey(config.zones, zoneId) });
  }

  function updateInteriorDoor(
    zoneId: string,
    doorIndex: number,
    field: "id" | "connectsTo",
    value: string,
  ) {
    if (!config) return;
    const oldDoor = config.zones[zoneId].interiorDoors[doorIndex];
    const newDoor = { ...oldDoor, [field]: value };

    const zones = { ...config.zones };

    // Update the source zone
    zones[zoneId] = {
      ...zones[zoneId],
      interiorDoors: zones[zoneId].interiorDoors.map((d, i) => (i === doorIndex ? newDoor : d)),
    };

    // Remove old mirror if sensor or target changed
    if (oldDoor.id && oldDoor.connectsTo && zones[oldDoor.connectsTo]) {
      const otherZone = zones[oldDoor.connectsTo];
      const filtered = otherZone.interiorDoors.filter(
        (d) => !(d.id === oldDoor.id && d.connectsTo === zoneId),
      );
      if (filtered.length !== otherZone.interiorDoors.length) {
        zones[oldDoor.connectsTo] = { ...otherZone, interiorDoors: filtered };
      }
    }

    // Add new mirror if both fields are set
    if (newDoor.id && newDoor.connectsTo && zones[newDoor.connectsTo]) {
      const otherZone = zones[newDoor.connectsTo];
      const mirror = { id: newDoor.id, connectsTo: zoneId };
      const alreadyExists = otherZone.interiorDoors.some(
        (d) => d.id === mirror.id && d.connectsTo === mirror.connectsTo,
      );
      if (!alreadyExists) {
        zones[newDoor.connectsTo] = {
          ...otherZone,
          interiorDoors: [...otherZone.interiorDoors, mirror],
        };
      }
    }

    setConfig({ ...config, zones });
  }

  function addInteriorDoor(zoneId: string) {
    if (!config) return;
    const zone = config.zones[zoneId];
    setConfig({
      ...config,
      zones: {
        ...config.zones,
        [zoneId]: {
          ...zone,
          interiorDoors: [...zone.interiorDoors, { id: "", connectsTo: "" }],
        },
      },
    });
  }

  function removeInteriorDoor(zoneId: string, doorIndex: number) {
    if (!config) return;
    const door = config.zones[zoneId].interiorDoors[doorIndex];
    const zones = { ...config.zones };

    // Remove from source zone
    zones[zoneId] = {
      ...zones[zoneId],
      interiorDoors: zones[zoneId].interiorDoors.filter((_, i) => i !== doorIndex),
    };

    // Remove mirror from connected zone
    if (door.id && door.connectsTo && zones[door.connectsTo]) {
      const otherZone = zones[door.connectsTo];
      zones[door.connectsTo] = {
        ...otherZone,
        interiorDoors: otherZone.interiorDoors.filter(
          (d) => !(d.id === door.id && d.connectsTo === zoneId),
        ),
      };
    }

    setConfig({ ...config, zones });
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-500">Loading settings...</p>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-6">
        <button onClick={onBack} className="text-sm text-blue-600 hover:text-blue-800 mb-4">
          &larr; Back to Dashboard
        </button>
        <p className="text-red-600">{error || "Failed to load config"}</p>
      </div>
    );
  }

  const sensorIds = Object.keys(config.sensorDelays);
  const zoneIds = Object.keys(config.zones);

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <header className="flex items-center justify-between mb-6">
        <h1 className="text-lg font-semibold">Settings</h1>
        <button onClick={onBack} className="text-sm text-gray-500 hover:text-gray-700">
          &larr; Dashboard
        </button>
      </header>

      {error && <p className="text-red-600 text-sm mb-4">{error}</p>}
      {success && <p className="text-green-600 text-sm mb-4">{success}</p>}
      {validationErrors.length > 0 && (
        <div className="bg-red-50 border border-red-300 rounded-lg p-3 mb-4 text-sm text-red-800">
          <p className="font-semibold mb-1">Config validation errors:</p>
          <ul className="list-disc pl-4">
            {validationErrors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs">Fix these issues and save to restore normal operation.</p>
        </div>
      )}

      {/* HVAC Units */}
      <section className="mb-8">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
          HVAC Units
        </h2>
        <div className="space-y-3">
          {Object.entries(config.hvacUnits).map(([unitId, unit]) => (
            <div key={unitId} className="border rounded p-3 space-y-2">
              <div className="flex gap-2">
                <input
                  type="text"
                  defaultValue={unitId}
                  onBlur={(e) => renameHvacUnitId(unitId, e.target.value.trim())}
                  placeholder="Unit ID"
                  className="flex-1 border rounded px-2 py-1 text-sm font-mono"
                />
                <input
                  type="text"
                  value={unit.name}
                  onChange={(e) => updateHvacUnit(unitId, "name", e.target.value)}
                  placeholder="Display name"
                  className="flex-1 border rounded px-2 py-1 text-sm"
                />
              </div>
              <div className="flex gap-2 items-center text-sm">
                <span className="text-xs text-gray-400 font-mono">{unit.iftttEvent}</span>
                <label className="text-xs text-gray-500 ml-auto">Delay:</label>
                <input
                  type="number"
                  value={unit.delaySeconds}
                  onChange={(e) =>
                    updateHvacUnit(unitId, "delaySeconds", parseInt(e.target.value) || 300)
                  }
                  className="w-20 border rounded px-2 py-1 text-sm"
                  min={0}
                />
                <button
                  type="button"
                  onClick={() => removeHvacUnit(unitId)}
                  className="text-red-500 text-sm hover:text-red-700"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={addHvacUnit}
          className="mt-2 text-sm text-blue-600 hover:text-blue-800"
        >
          + Add HVAC unit
        </button>
      </section>

      {/* Sensors */}
      <section className="mb-8">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
          Sensors
        </h2>
        <div className="space-y-3">
          {sensorIds.map((sensorId) => (
            <div key={sensorId} className="border rounded p-3 space-y-2">
              <div className="flex gap-2">
                <input
                  type="text"
                  defaultValue={sensorId}
                  onBlur={(e) => renameSensorId(sensorId, e.target.value.trim())}
                  placeholder="Sensor ID"
                  className="flex-1 border rounded px-2 py-1 text-sm font-mono"
                />
                <input
                  type="text"
                  value={config.sensorNames[sensorId] ?? ""}
                  onChange={(e) => updateSensorName(sensorId, e.target.value)}
                  placeholder="Display name"
                  className="flex-1 border rounded px-2 py-1 text-sm"
                />
              </div>
              <div className="flex gap-2 items-center">
                <label className="text-xs text-gray-500">Delay:</label>
                <input
                  type="number"
                  value={config.sensorDelays[sensorId]}
                  onChange={(e) => updateSensorDelay(sensorId, parseInt(e.target.value) || 300)}
                  className="w-20 border rounded px-2 py-1 text-sm"
                  min={0}
                />
                <label className="text-xs text-gray-500 ml-2">Default:</label>
                <select
                  value={config.sensorDefaults[sensorId] ?? ""}
                  onChange={(e) => updateSensorDefault(sensorId, e.target.value)}
                  className="border rounded px-2 py-1 text-sm"
                >
                  <option value="">None</option>
                  <option value="closed">Closed</option>
                  <option value="open">Open</option>
                </select>
                <button
                  type="button"
                  onClick={() => removeSensor(sensorId)}
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
          className="mt-2 text-sm text-blue-600 hover:text-blue-800"
        >
          + Add sensor
        </button>
      </section>

      {/* Zones */}
      <section className="mb-8">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Zones</h2>
        <div className="space-y-4">
          {zoneIds.map((zoneId) => {
            const zone = config.zones[zoneId];
            return (
              <div key={zoneId} className="border rounded p-3 space-y-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-mono font-semibold">{zoneId}</span>
                  <button
                    type="button"
                    onClick={() => removeZone(zoneId)}
                    className="text-red-500 text-sm ml-auto hover:text-red-700"
                  >
                    Remove
                  </button>
                </div>

                <div>
                  <label className="text-xs font-medium text-gray-500">HVAC Units</label>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {Object.entries(config.hvacUnits).map(([uid, unit]) => (
                      <button
                        key={uid}
                        type="button"
                        onClick={() => toggleZoneItem(zoneId, "minisplits", uid)}
                        className={`text-xs px-2 py-1 rounded border ${
                          zone.minisplits.includes(uid)
                            ? "bg-blue-100 border-blue-300 text-blue-700"
                            : "bg-gray-50 border-gray-200 text-gray-600"
                        }`}
                      >
                        {unit.name || uid}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-xs font-medium text-gray-500">Exterior Sensors</label>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {sensorIds.map((sid) => (
                      <button
                        key={sid}
                        type="button"
                        onClick={() => toggleZoneItem(zoneId, "exteriorOpenings", sid)}
                        className={`text-xs px-2 py-1 rounded border ${
                          zone.exteriorOpenings.includes(sid)
                            ? "bg-blue-100 border-blue-300 text-blue-700"
                            : "bg-gray-50 border-gray-200 text-gray-600"
                        }`}
                      >
                        {config.sensorNames[sid] || sid}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-xs font-medium text-gray-500">Interior Doors</label>
                  {zone.interiorDoors.map((door, di) => (
                    <div key={di} className="flex gap-2 mt-1">
                      <select
                        value={door.id}
                        onChange={(e) => updateInteriorDoor(zoneId, di, "id", e.target.value)}
                        className="flex-1 border rounded px-2 py-1 text-sm"
                      >
                        <option value="">Select sensor...</option>
                        {sensorIds.map((sid) => (
                          <option key={sid} value={sid}>
                            {config.sensorNames[sid] || sid}
                          </option>
                        ))}
                      </select>
                      <select
                        value={door.connectsTo}
                        onChange={(e) =>
                          updateInteriorDoor(zoneId, di, "connectsTo", e.target.value)
                        }
                        className="flex-1 border rounded px-2 py-1 text-sm"
                      >
                        <option value="">Connects to...</option>
                        {zoneIds
                          .filter((z) => z !== zoneId)
                          .map((z) => (
                            <option key={z} value={z}>
                              {z}
                            </option>
                          ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => removeInteriorDoor(zoneId, di)}
                        className="text-red-500 text-sm"
                      >
                        x
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => addInteriorDoor(zoneId)}
                    className="text-xs text-blue-600 mt-1 hover:text-blue-800"
                  >
                    + Add interior door
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        <button
          type="button"
          onClick={addZone}
          className="mt-2 text-sm text-blue-600 hover:text-blue-800"
        >
          + Add zone
        </button>
      </section>

      {/* System */}
      <section className="mb-8">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">System</h2>
        <div className="space-y-2">
          <div>
            <label className="text-xs font-medium text-gray-500">Turn-off URL</label>
            <input
              type="url"
              value={config.turnOffUrl}
              onChange={(e) => setConfig({ ...config, turnOffUrl: e.target.value })}
              className="w-full border rounded px-2 py-1 text-sm mt-1"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500">YoLink Base URL</label>
            <input
              type="url"
              value={config.yolink.baseUrl}
              onChange={(e) =>
                setConfig({ ...config, yolink: { ...config.yolink, baseUrl: e.target.value } })
              }
              className="w-full border rounded px-2 py-1 text-sm mt-1"
            />
          </div>
        </div>
      </section>

      <div className="flex gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save Settings"}
        </button>
        <button
          onClick={onBack}
          className="border border-gray-300 text-gray-600 px-4 py-2 rounded text-sm hover:bg-gray-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
