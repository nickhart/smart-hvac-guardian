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
  iftttEvent: string;
  delaySeconds: number;
}

export function Step5HvacUnits({ data, onSave }: StepProps) {
  const [units, setUnits] = useState<HvacEntry[]>(() => {
    const hvacUnits = (data.hvacUnits ?? {}) as Record<
      string,
      { name?: string; iftttEvent?: string; delaySeconds?: number }
    >;
    const entries = Object.entries(hvacUnits).map(([id, u]) => ({
      id,
      name: u.name ?? "",
      iftttEvent: u.iftttEvent ?? "",
      delaySeconds: u.delaySeconds ?? 300,
    }));
    return entries.length > 0 ? entries : [{ id: "", name: "", iftttEvent: "", delaySeconds: 300 }];
  });

  function addUnit() {
    setUnits((prev) => [...prev, { id: "", name: "", iftttEvent: "", delaySeconds: 300 }]);
  }

  function removeUnit(index: number) {
    setUnits((prev) => prev.filter((_, i) => i !== index));
  }

  function updateUnit(index: number, field: keyof HvacEntry, value: string | number) {
    setUnits((prev) => prev.map((u, i) => (i === index ? { ...u, [field]: value } : u)));
  }

  return (
    <div>
      <h2 className="text-lg font-semibold mb-2">HVAC Units</h2>
      <p className="text-sm text-gray-600 mb-4">
        Add your minisplit/HVAC units. Each unit needs an ID, display name, IFTTT event name (for
        the turn-off trigger), and a default delay in seconds.
      </p>

      <form
        data-step-form
        onSubmit={(e) => {
          e.preventDefault();
          const hvacUnits: Record<string, unknown> = {};
          for (const u of units) {
            if (!u.id) continue;
            hvacUnits[u.id] = {
              name: u.name || u.id,
              iftttEvent: u.iftttEvent,
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
                  value={unit.id}
                  onChange={(e) => updateUnit(i, "id", e.target.value)}
                  placeholder="Unit ID"
                  className="flex-1 border rounded px-2 py-1 text-sm"
                  required
                />
                <input
                  type="text"
                  value={unit.name}
                  onChange={(e) => updateUnit(i, "name", e.target.value)}
                  placeholder="Display name"
                  className="flex-1 border rounded px-2 py-1 text-sm"
                />
              </div>
              <div className="flex gap-2 items-center">
                <input
                  type="text"
                  value={unit.iftttEvent}
                  onChange={(e) => updateUnit(i, "iftttEvent", e.target.value)}
                  placeholder="IFTTT event name"
                  className="flex-1 border rounded px-2 py-1 text-sm"
                  required
                />
                <label className="text-xs text-gray-500">Delay:</label>
                <input
                  type="number"
                  value={unit.delaySeconds}
                  onChange={(e) => updateUnit(i, "delaySeconds", parseInt(e.target.value) || 300)}
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
