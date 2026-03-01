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
  name: string;
  minisplits: string[];
  exteriorOpenings: string[];
  interiorDoors: InteriorDoor[];
  idManuallyEdited: boolean;
}

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

export function Step4Zones({ data, allStepData, onSave }: StepProps) {
  const [zones, setZones] = useState<ZoneEntry[]>(() => {
    const zonesObj = (data.zones ?? {}) as Record<
      string,
      {
        name?: string;
        minisplits?: string[];
        exteriorOpenings?: string[];
        interiorDoors?: InteriorDoor[];
      }
    >;
    const entries = Object.entries(zonesObj).map(([id, z]) => ({
      id,
      name: z.name ?? "",
      minisplits: z.minisplits ?? [],
      exteriorOpenings: z.exteriorOpenings ?? [],
      interiorDoors: z.interiorDoors ?? [],
      idManuallyEdited: true,
    }));
    return entries.length > 0
      ? entries
      : [
          {
            id: "",
            name: "",
            minisplits: [],
            exteriorOpenings: [],
            interiorDoors: [],
            idManuallyEdited: false,
          },
        ];
  });

  // Available sensors from step 3
  const step3 = allStepData["3"] ?? {};
  const sensorIds = Object.keys((step3.sensorDelays ?? {}) as Record<string, unknown>);
  const sensorNames = (step3.sensorNames ?? {}) as Record<string, string>;

  // Available HVAC units from step 4 (HVAC Units step)
  const step4 = allStepData["4"] ?? {};
  const hvacUnits = (step4.hvacUnits ?? {}) as Record<string, { name?: string }>;
  const hvacUnitIds = Object.keys(hvacUnits);

  function addZone() {
    setZones((prev) => [
      ...prev,
      {
        id: "",
        name: "",
        minisplits: [],
        exteriorOpenings: [],
        interiorDoors: [],
        idManuallyEdited: false,
      },
    ]);
  }

  function removeZone(index: number) {
    setZones((prev) => prev.filter((_, i) => i !== index));
  }

  function updateZoneName(index: number, name: string) {
    setZones((prev) =>
      prev.map((z, i) => {
        if (i !== index) return z;
        const id = z.idManuallyEdited ? z.id : toSlug(name);
        return { ...z, name, id };
      }),
    );
  }

  function updateZoneId(index: number, id: string) {
    setZones((prev) =>
      prev.map((z, i) => {
        if (i !== index) return z;
        const manuallyEdited = id !== "" || z.idManuallyEdited;
        return { ...z, id, idManuallyEdited: manuallyEdited };
      }),
    );
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

  function toggleMinisplit(zoneIndex: number, unitId: string) {
    setZones((prev) =>
      prev.map((z, i) => {
        if (i !== zoneIndex) return z;
        const has = z.minisplits.includes(unitId);
        return {
          ...z,
          minisplits: has ? z.minisplits.filter((s) => s !== unitId) : [...z.minisplits, unitId],
        };
      }),
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
    setZones((prev) => {
      const srcZone = prev[zoneIndex];
      const oldDoor = srcZone.interiorDoors[doorIndex];
      const newDoor = { ...oldDoor, [field]: value };

      return prev.map((z, i) => {
        if (i === zoneIndex) {
          return {
            ...z,
            interiorDoors: z.interiorDoors.map((d, di) => (di === doorIndex ? newDoor : d)),
          };
        }

        // Remove old mirror if sensor or target changed
        if (oldDoor.id && oldDoor.connectsTo && z.id === oldDoor.connectsTo) {
          const filtered = z.interiorDoors.filter(
            (d) => !(d.id === oldDoor.id && d.connectsTo === srcZone.id),
          );
          if (filtered.length !== z.interiorDoors.length) {
            return { ...z, interiorDoors: filtered };
          }
        }

        // Add new mirror if both fields are set
        if (newDoor.id && newDoor.connectsTo && z.id === newDoor.connectsTo) {
          const mirror = { id: newDoor.id, connectsTo: srcZone.id };
          const alreadyExists = z.interiorDoors.some(
            (d) => d.id === mirror.id && d.connectsTo === mirror.connectsTo,
          );
          if (!alreadyExists) {
            return { ...z, interiorDoors: [...z.interiorDoors, mirror] };
          }
        }

        return z;
      });
    });
  }

  function removeInteriorDoor(zoneIndex: number, doorIndex: number) {
    setZones((prev) => {
      const srcZone = prev[zoneIndex];
      const door = srcZone.interiorDoors[doorIndex];

      return prev.map((z, i) => {
        if (i === zoneIndex) {
          return { ...z, interiorDoors: z.interiorDoors.filter((_, di) => di !== doorIndex) };
        }
        // Remove mirror from the connected zone
        if (door.id && door.connectsTo && z.id === door.connectsTo) {
          return {
            ...z,
            interiorDoors: z.interiorDoors.filter(
              (d) => !(d.id === door.id && d.connectsTo === srcZone.id),
            ),
          };
        }
        return z;
      });
    });
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
            const zoneId = z.id.trim();
            if (!zoneId) continue;
            zonesObj[zoneId] = {
              name: z.name.trim() || zoneId,
              minisplits: z.minisplits.map((s) => s.trim()),
              exteriorOpenings: z.exteriorOpenings.map((s) => s.trim()),
              interiorDoors: z.interiorDoors
                .filter((d) => d.id && d.connectsTo)
                .map((d) => ({ id: d.id.trim(), connectsTo: d.connectsTo.trim() })),
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
                  value={zone.name}
                  onChange={(e) => updateZoneName(zi, e.target.value)}
                  placeholder="Zone name (e.g. Living Room)"
                  className="flex-1 border rounded px-2 py-1 text-sm"
                />
                <input
                  type="text"
                  value={zone.id}
                  onChange={(e) => updateZoneId(zi, e.target.value)}
                  placeholder="Zone ID"
                  className="flex-1 border rounded px-2 py-1 text-sm font-mono text-gray-700 bg-gray-50"
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
                <label className="text-xs font-medium text-gray-500">HVAC Units</label>
                <div className="flex flex-wrap gap-1 mt-1">
                  {hvacUnitIds.map((uid) => (
                    <button
                      key={uid}
                      type="button"
                      onClick={() => toggleMinisplit(zi, uid)}
                      className={`text-xs px-2 py-1 rounded border ${
                        zone.minisplits.includes(uid)
                          ? "bg-primary-100 border-primary-300 text-primary-700"
                          : "bg-gray-50 border-gray-200 text-gray-600"
                      }`}
                    >
                      {hvacUnits[uid]?.name || uid}
                    </button>
                  ))}
                  {hvacUnitIds.length === 0 && (
                    <span className="text-xs text-gray-400">
                      No HVAC units defined yet. Go back to add units.
                    </span>
                  )}
                </div>
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
                          ? "bg-primary-100 border-primary-300 text-primary-700"
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
                            {z.name || z.id}
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
                  className="text-xs text-primary-600 mt-1 hover:text-primary-800"
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
          className="mt-3 text-sm text-primary-600 hover:text-primary-800"
        >
          + Add zone
        </button>
      </form>
    </div>
  );
}
