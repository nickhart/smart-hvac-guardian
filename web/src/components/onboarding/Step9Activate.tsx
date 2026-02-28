import { useState } from "react";
import * as api from "../../lib/api";

interface Step9Props {
  onComplete: () => void;
}

export function Step9Activate({ onComplete }: Step9Props) {
  const [activating, setActivating] = useState(false);
  const [result, setResult] = useState<{
    ok: boolean;
    message: string;
    webhookUrls?: { sensorEvent: string; hvacEvent: string };
    webhookSecret?: string;
  } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  async function handleActivate() {
    setActivating(true);
    try {
      const res = await api.activateOnboarding();
      setResult({
        ok: res.status === "ok",
        message: res.message,
        webhookUrls: res.webhookUrls,
        webhookSecret: res.webhookSecret,
      });
    } catch (err) {
      setResult({
        ok: false,
        message: err instanceof Error ? err.message : "Activation failed",
      });
    } finally {
      setActivating(false);
    }
  }

  function handleCopy(text: string, label: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    });
  }

  function handleContinue() {
    onComplete();
  }

  return (
    <div>
      <h2 className="text-lg font-semibold mb-2">Activate</h2>
      <p className="text-sm text-gray-600 mb-4">
        Everything is configured. Click below to activate your HVAC Guardian system.
      </p>

      {!result && (
        <button
          type="button"
          onClick={handleActivate}
          disabled={activating}
          className="w-full bg-green-600 text-white rounded py-3 font-medium hover:bg-green-700 disabled:opacity-50"
        >
          {activating ? "Activating..." : "Activate System"}
        </button>
      )}

      {result && (
        <div
          className={`p-4 rounded ${result.ok ? "bg-green-50 border border-green-200" : "bg-red-50 border border-red-200"}`}
        >
          <p className={`font-medium ${result.ok ? "text-green-800" : "text-red-800"}`}>
            {result.message}
          </p>

          {result.webhookSecret && (
            <div className="mt-3 text-sm">
              <p className="font-medium text-gray-700 mb-1">Webhook Secret</p>
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 mb-2">
                Save this secret now — it will not be shown again.
              </p>
              <div className="bg-white rounded p-2 flex items-center gap-2">
                <code className="text-xs break-all flex-1">{result.webhookSecret}</code>
                <button
                  type="button"
                  onClick={() => handleCopy(result.webhookSecret!, "secret")}
                  className="text-xs bg-gray-100 hover:bg-gray-200 rounded px-2 py-1 whitespace-nowrap"
                >
                  {copied === "secret" ? "Copied!" : "Copy"}
                </button>
              </div>

              <div className="mt-3 bg-gray-50 rounded p-2">
                <p className="text-xs text-gray-600 mb-1">
                  Add this header to your IFTTT webhook requests:
                </p>
                <div className="flex items-center gap-2">
                  <code className="text-xs break-all flex-1">
                    Authorization: Bearer {result.webhookSecret}
                  </code>
                  <button
                    type="button"
                    onClick={() =>
                      handleCopy(`Authorization: Bearer ${result.webhookSecret}`, "header")
                    }
                    className="text-xs bg-gray-100 hover:bg-gray-200 rounded px-2 py-1 whitespace-nowrap"
                  >
                    {copied === "header" ? "Copied!" : "Copy"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {result.webhookUrls && (
            <div className="mt-3 text-sm">
              <p className="font-medium text-gray-700 mb-1">
                Configure these webhook URLs in your IFTTT applets:
              </p>
              <div className="bg-white rounded p-2 space-y-1">
                <p className="text-xs text-gray-500">Sensor events:</p>
                <code className="text-xs break-all block">{result.webhookUrls.sensorEvent}</code>
                <p className="text-xs text-gray-500 mt-2">HVAC events:</p>
                <code className="text-xs break-all block">{result.webhookUrls.hvacEvent}</code>
              </div>
            </div>
          )}

          {result.ok && (
            <button
              type="button"
              onClick={handleContinue}
              className="mt-4 w-full bg-green-600 text-white rounded py-2 text-sm font-medium hover:bg-green-700"
            >
              Continue to Dashboard
            </button>
          )}
        </div>
      )}
    </div>
  );
}
