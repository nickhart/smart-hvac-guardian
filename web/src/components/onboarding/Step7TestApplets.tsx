import { useState } from "react";
import * as api from "../../lib/api";

interface StepProps {
  data: Record<string, unknown>;
  allStepData: Record<string, Record<string, unknown>>;
  onSave: (data: Record<string, unknown>) => void;
  saving: boolean;
}

export function Step7TestApplets({ allStepData, onSave }: StepProps) {
  const [results, setResults] = useState<Record<string, { ok: boolean; message: string }>>({});
  const [testing, setTesting] = useState<string | null>(null);

  const step4 = allStepData["4"] ?? {};
  const hvacUnits = (step4.hvacUnits ?? {}) as Record<
    string,
    { name?: string; iftttEvent?: string }
  >;

  async function handleTestApplet(unitId: string, iftttEvent: string) {
    setTesting(unitId);
    try {
      const res = await api.testIftttApplet(iftttEvent);
      setResults((prev) => ({
        ...prev,
        [unitId]: { ok: res.status === "ok", message: res.message },
      }));
    } catch (err) {
      setResults((prev) => ({
        ...prev,
        [unitId]: { ok: false, message: err instanceof Error ? err.message : "Test failed" },
      }));
    } finally {
      setTesting(null);
    }
  }

  const unitEntries = Object.entries(hvacUnits);

  return (
    <div>
      <h2 className="text-lg font-semibold mb-2">Test IFTTT Applets</h2>
      <p className="text-sm text-gray-600 mb-4">
        Test each HVAC unit&apos;s IFTTT applet. Make sure the applets are set up in IFTTT before
        testing. This step is optional but recommended.
      </p>

      {unitEntries.length === 0 ? (
        <p className="text-sm text-gray-500">No HVAC units configured. Go back to step 5.</p>
      ) : (
        <div className="space-y-3">
          {unitEntries.map(([unitId, unit]) => (
            <div key={unitId} className="border rounded p-3 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">{unit.name || unitId}</p>
                <p className="text-xs text-gray-500">Event: {unit.iftttEvent}</p>
                {results[unitId] && (
                  <p
                    className={`text-xs mt-1 ${results[unitId].ok ? "text-green-600" : "text-red-600"}`}
                  >
                    {results[unitId].message}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => handleTestApplet(unitId, unit.iftttEvent ?? "")}
                disabled={testing === unitId || !unit.iftttEvent}
                className="text-sm bg-gray-100 border px-3 py-1.5 rounded hover:bg-gray-200 disabled:opacity-50"
              >
                {testing === unitId ? "Testing..." : "Test"}
              </button>
            </div>
          ))}
        </div>
      )}

      <form
        data-step-form
        onSubmit={(e) => {
          e.preventDefault();
          onSave({ tested: true });
        }}
      />
    </div>
  );
}
