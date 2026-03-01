import { useState } from "react";

interface StepProps {
  data: Record<string, unknown>;
  allStepData: Record<string, Record<string, unknown>>;
  onSave: (data: Record<string, unknown>) => void;
  saving: boolean;
}

interface HvacEntry {
  id: string;
  name: string;
  delaySeconds: number;
  idManuallyEdited: boolean;
}

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

export function Step5HvacUnits({ data, onSave }: StepProps) {
  const [units, setUnits] = useState<HvacEntry[]>(() => {
    const hvacUnits = (data.hvacUnits ?? {}) as Record<
      string,
      { name?: string; delaySeconds?: number }
    >;
    const entries = Object.entries(hvacUnits).map(([id, u]) => ({
      id,
      name: u.name ?? "",
      delaySeconds: u.delaySeconds ?? 300,
      idManuallyEdited: true,
    }));
    return entries.length > 0
      ? entries
      : [{ id: "", name: "", delaySeconds: 300, idManuallyEdited: false }];
  });

  function addUnit() {
    setUnits((prev) => [...prev, { id: "", name: "", delaySeconds: 300, idManuallyEdited: false }]);
  }

  function removeUnit(index: number) {
    setUnits((prev) => prev.filter((_, i) => i !== index));
  }

  function updateName(index: number, name: string) {
    setUnits((prev) =>
      prev.map((u, i) => {
        if (i !== index) return u;
        const id = u.idManuallyEdited ? u.id : toSlug(name);
        return { ...u, name, id };
      }),
    );
  }

  function updateId(index: number, id: string) {
    setUnits((prev) =>
      prev.map((u, i) => {
        if (i !== index) return u;
        const manuallyEdited = id !== "" || u.idManuallyEdited;
        return { ...u, id, idManuallyEdited: manuallyEdited };
      }),
    );
  }

  function updateDelay(index: number, delaySeconds: number) {
    setUnits((prev) => prev.map((u, i) => (i === index ? { ...u, delaySeconds } : u)));
  }

  return (
    <div>
      <h2 className="text-lg font-semibold mb-2">HVAC Units</h2>
      <p className="text-sm text-gray-600 mb-4">
        Add your minisplit/HVAC units. Each unit needs a display name and an ID (auto-generated from
        the name). The IFTTT event name is auto-derived as turn_off_{"{unitId}"}.
      </p>

      <form
        data-step-form
        onSubmit={(e) => {
          e.preventDefault();
          const hvacUnits: Record<string, unknown> = {};
          for (const u of units) {
            const id = u.id.trim();
            if (!id) continue;
            const name = (u.name || id).trim();
            hvacUnits[id] = {
              name,
              iftttEvent: `turn_off_${id}`,
              delaySeconds: u.delaySeconds,
            };
          }
          onSave({ hvacUnits });
        }}
      >
        <div className="space-y-3">
          {units.map((unit, i) => (
            <div key={i} className="border rounded p-3 space-y-2">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={unit.name}
                  onChange={(e) => updateName(i, e.target.value)}
                  placeholder="Display name (e.g. Master Bedroom AC)"
                  className="flex-1 border rounded px-2 py-1 text-sm"
                />
                <input
                  type="text"
                  value={unit.id}
                  onChange={(e) => updateId(i, e.target.value)}
                  placeholder="Unit ID"
                  className="flex-1 border rounded px-2 py-1 text-sm font-mono text-gray-700 bg-gray-50"
                  required
                />
              </div>
              <div className="flex gap-2 items-center">
                <label className="text-xs text-gray-500">Delay:</label>
                <input
                  type="number"
                  value={unit.delaySeconds}
                  onChange={(e) => updateDelay(i, parseInt(e.target.value) || 300)}
                  className="w-20 border rounded px-2 py-1 text-sm"
                  min={0}
                />
                <button
                  type="button"
                  onClick={() => removeUnit(i)}
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
          onClick={addUnit}
          className="mt-3 text-sm text-blue-600 hover:text-blue-800"
        >
          + Add HVAC unit
        </button>
      </form>
    </div>
  );
}
