import { useState } from "react";
import * as api from "../../lib/api";

interface StepProps {
  data: Record<string, unknown>;
  allStepData: Record<string, Record<string, unknown>>;
  onSave: (data: Record<string, unknown>) => void;
  saving: boolean;
}

export function Step8Review({ allStepData, onSave }: StepProps) {
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{
    ok: boolean;
    message: string;
    errors?: unknown;
    webhookUrls?: { sensorEvent: string; hvacEvent: string };
  } | null>(null);

  const step3 = allStepData["3"] ?? {};
  const step4 = allStepData["4"] ?? {}; // HVAC units (Step5HvacUnits renders at step 4)
  const step5 = allStepData["5"] ?? {}; // Zones (Step4Zones renders at step 5)

  const sensorCount = Object.keys((step3.sensorDelays ?? {}) as Record<string, unknown>).length;
  const zoneCount = Object.keys((step5.zones ?? {}) as Record<string, unknown>).length;
  const unitCount = Object.keys((step4.hvacUnits ?? {}) as Record<string, unknown>).length;

  async function handleVerify() {
    setVerifying(true);
    setVerifyResult(null);
    try {
      const res = await api.verifyOnboarding();
      setVerifyResult({
        ok: res.status === "ok",
        message: res.message,
        errors: res.errors,
        webhookUrls: res.webhookUrls,
      });
    } catch (err) {
      setVerifyResult({
        ok: false,
        message: err instanceof Error ? err.message : "Verification failed",
      });
    } finally {
      setVerifying(false);
    }
  }

  return (
    <div>
      <h2 className="text-lg font-semibold mb-2">Review Configuration</h2>
      <p className="text-sm text-gray-600 mb-4">
        Review your setup before activating. Click &quot;Verify&quot; to validate your
        configuration.
      </p>

      <div className="space-y-2 text-sm mb-4">
        <div className="flex justify-between p-2 bg-gray-50 rounded">
          <span className="text-gray-600">Sensors</span>
          <span className="font-medium">{sensorCount}</span>
        </div>
        <div className="flex justify-between p-2 bg-gray-50 rounded">
          <span className="text-gray-600">Zones</span>
          <span className="font-medium">{zoneCount}</span>
        </div>
        <div className="flex justify-between p-2 bg-gray-50 rounded">
          <span className="text-gray-600">HVAC Units</span>
          <span className="font-medium">{unitCount}</span>
        </div>
        <div className="flex justify-between p-2 bg-gray-50 rounded">
          <span className="text-gray-600">YoLink credentials</span>
          <span className="font-medium">{allStepData["2"]?.uaCid ? "Set" : "Missing"}</span>
        </div>
        <div className="flex justify-between p-2 bg-gray-50 rounded">
          <span className="text-gray-600">IFTTT webhook key</span>
          <span className="font-medium">{allStepData["6"]?.webhookKey ? "Set" : "Missing"}</span>
        </div>
      </div>

      <button
        type="button"
        onClick={handleVerify}
        disabled={verifying}
        className="w-full bg-primary-600 text-white rounded py-2 text-sm font-medium hover:bg-primary-700 disabled:opacity-50 mb-3"
      >
        {verifying ? "Verifying..." : "Verify Configuration"}
      </button>

      {verifyResult && (
        <div
          className={`p-3 rounded text-sm ${verifyResult.ok ? "bg-green-50 text-green-800 border border-green-200" : "bg-red-50 text-red-800 border border-red-200"}`}
        >
          <p className="font-medium">{verifyResult.message}</p>
          {verifyResult.errors ? (
            <pre className="text-xs mt-2 overflow-auto max-h-32">
              {JSON.stringify(verifyResult.errors, null, 2)}
            </pre>
          ) : null}
          {verifyResult.webhookUrls && (
            <div className="mt-2">
              <p className="text-xs font-medium">Webhook URLs:</p>
              <p className="text-xs break-all">{verifyResult.webhookUrls.sensorEvent}</p>
              <p className="text-xs break-all">{verifyResult.webhookUrls.hvacEvent}</p>
            </div>
          )}
        </div>
      )}

      <form
        data-step-form
        onSubmit={(e) => {
          e.preventDefault();
          onSave({ verified: verifyResult?.ok ?? false });
        }}
      />
    </div>
  );
}
