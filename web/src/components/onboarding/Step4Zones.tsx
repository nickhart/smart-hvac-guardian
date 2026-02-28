import { useState } from "react";

interface StepProps {
  data: Record<string, unknown>;
  allStepData: Record<string, Record<string, unknown>>;
  onSave: (data: Record<string, unknown>) => void;
  saving: boolean;
}

interface InteriorDoor {
  id: string;
  connectsTo: string;
}

interface ZoneEntry {
  id: string;
  minisplits: string[];
  exteriorOpenings: string[];
  interiorDoors: InteriorDoor[];
}

export function Step4Zones({ data, allStepData, onSave }: StepProps) {
  const [zones, setZones] = useState<ZoneEntry[]>(() => {
    const zonesObj = (data.zones ?? {}) as Record<
      string,
      {
        minisplits?: string[];
        exteriorOpenings?: string[];
        interiorDoors?: InteriorDoor[];
      }
    >;
    const entries = Object.entries(zonesObj).map(([id, z]) => ({
      id,
      minisplits: z.minisplits ?? [],
      exteriorOpenings: z.exteriorOpenings ?? [],
      interiorDoors: z.interiorDoors ?? [],
    }));
    return entries.length > 0
      ? entries
      : [{ id: "", minisplits: [], exteriorOpenings: [], interiorDoors: [] }];
  });

  // Available sensors from step 3
  const step3 = allStepData["3"] ?? {};
  const sensorIds = Object.keys((step3.sensorDelays ?? {}) as Record<string, unknown>);
  const sensorNames = (step3.sensorNames ?? {}) as Record<string, string>;

  function addZone() {
    setZones((prev) => [
      ...prev,
      { id: "", minisplits: [], exteriorOpenings: [], interiorDoors: [] },
    ]);
  }

  function removeZone(index: number) {
    setZones((prev) => prev.filter((_, i) => i !== index));
  }

  function updateZoneId(index: number, id: string) {
    setZones((prev) => prev.map((z, i) => (i === index ? { ...z, id } : z)));
  }

  function toggleExteriorOpening(zoneIndex: number, sensorId: string) {
    setZones((prev) =>
      prev.map((z, i) => {
        if (i !== zoneIndex) return z;
        const has = z.exteriorOpenings.includes(sensorId);
        return {
          ...z,
          exteriorOpenings: has
            ? z.exteriorOpenings.filter((s) => s !== sensorId)
            : [...z.exteriorOpenings, sensorId],
        };
      }),
    );
  }

  function updateMinisplits(zoneIndex: number, value: string) {
    setZones((prev) =>
      prev.map((z, i) =>
        i === zoneIndex
          ? {
              ...z,
              minisplits: value
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            }
          : z,
      ),
    );
  }

  function addInteriorDoor(zoneIndex: number) {
    setZones((prev) =>
      prev.map((z, i) =>
        i === zoneIndex
          ? { ...z, interiorDoors: [...z.interiorDoors, { id: "", connectsTo: "" }] }
          : z,
      ),
    );
  }

  function updateInteriorDoor(
    zoneIndex: number,
    doorIndex: number,
    field: "id" | "connectsTo",
    value: string,
  ) {
    setZones((prev) =>
      prev.map((z, i) =>
        i === zoneIndex
          ? {
              ...z,
              interiorDoors: z.interiorDoors.map((d, di) =>
                di === doorIndex ? { ...d, [field]: value } : d,
              ),
            }
          : z,
      ),
    );
  }

  function removeInteriorDoor(zoneIndex: number, doorIndex: number) {
    setZones((prev) =>
      prev.map((z, i) =>
        i === zoneIndex
          ? { ...z, interiorDoors: z.interiorDoors.filter((_, di) => di !== doorIndex) }
          : z,
      ),
    );
  }

  return (
    <div>
      <h2 className="text-lg font-semibold mb-2">Zones</h2>
      <p className="text-sm text-gray-600 mb-4">
        Define your property&apos;s zones (rooms or areas). Assign exterior sensors and HVAC units
        to each zone. Connect zones with interior doors.
      </p>

      <form
        data-step-form
        onSubmit={(e) => {
          e.preventDefault();
          const zonesObj: Record<string, unknown> = {};
          for (const z of zones) {
            if (!z.id) continue;
            zonesObj[z.id] = {
              minisplits: z.minisplits,
              exteriorOpenings: z.exteriorOpenings,
              interiorDoors: z.interiorDoors.filter((d) => d.id && d.connectsTo),
            };
          }
          onSave({ zones: zonesObj });
        }}
      >
        <div className="space-y-4">
          {zones.map((zone, zi) => (
            <div key={zi} className="border rounded p-3 space-y-3">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={zone.id}
                  onChange={(e) => updateZoneId(zi, e.target.value)}
                  placeholder="Zone ID (e.g., living_room)"
                  className="flex-1 border rounded px-2 py-1 text-sm"
                  required
                />
                <button
                  type="button"
                  onClick={() => removeZone(zi)}
                  className="text-red-500 text-sm hover:text-red-700"
                >
                  Remove
                </button>
              </div>

              <div>
                <label className="text-xs font-medium text-gray-500">
                  HVAC Unit IDs (comma-separated)
                </label>
                <input
                  type="text"
                  value={zone.minisplits.join(", ")}
                  onChange={(e) => updateMinisplits(zi, e.target.value)}
                  placeholder="unit_1, unit_2"
                  className="w-full border rounded px-2 py-1 text-sm mt-1"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-gray-500">Exterior Sensors</label>
                <div className="flex flex-wrap gap-1 mt-1">
                  {sensorIds.map((sid) => (
                    <button
                      key={sid}
                      type="button"
                      onClick={() => toggleExteriorOpening(zi, sid)}
                      className={`text-xs px-2 py-1 rounded border ${
                        zone.exteriorOpenings.includes(sid)
                          ? "bg-blue-100 border-blue-300 text-blue-700"
                          : "bg-gray-50 border-gray-200 text-gray-600"
                      }`}
                    >
                      {sensorNames[sid] || sid}
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
                      onChange={(e) => updateInteriorDoor(zi, di, "id", e.target.value)}
                      className="flex-1 border rounded px-2 py-1 text-sm"
                    >
                      <option value="">Select sensor...</option>
                      {sensorIds.map((sid) => (
                        <option key={sid} value={sid}>
                          {sensorNames[sid] || sid}
                        </option>
                      ))}
                    </select>
                    <select
                      value={door.connectsTo}
                      onChange={(e) => updateInteriorDoor(zi, di, "connectsTo", e.target.value)}
                      className="flex-1 border rounded px-2 py-1 text-sm"
                    >
                      <option value="">Connects to...</option>
                      {zones.map((z, i) =>
                        i !== zi && z.id ? (
                          <option key={z.id} value={z.id}>
                            {z.id}
                          </option>
                        ) : null,
                      )}
                    </select>
                    <button
                      type="button"
                      onClick={() => removeInteriorDoor(zi, di)}
                      className="text-red-500 text-sm"
                    >
                      x
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => addInteriorDoor(zi)}
                  className="text-xs text-blue-600 mt-1 hover:text-blue-800"
                >
                  + Add interior door
                </button>
              </div>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={addZone}
          className="mt-3 text-sm text-blue-600 hover:text-blue-800"
        >
          + Add zone
        </button>
      </form>
    </div>
  );
}
