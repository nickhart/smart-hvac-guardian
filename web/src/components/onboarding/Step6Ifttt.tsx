import { useState } from "react";
import * as api from "../../lib/api";

interface StepProps {
  data: Record<string, unknown>;
  allStepData: Record<string, Record<string, unknown>>;
  onSave: (data: Record<string, unknown>) => void;
  saving: boolean;
}

export function Step6Ifttt({ data, onSave, saving }: StepProps) {
  const [webhookKey, setWebhookKey] = useState((data.webhookKey as string) ?? "");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await api.testIftttKey(webhookKey);
      setTestResult({ ok: res.status === "ok", message: res.message });
    } catch (err) {
      setTestResult({ ok: false, message: err instanceof Error ? err.message : "Test failed" });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div>
      <h2 className="text-lg font-semibold mb-2">IFTTT Webhook Key</h2>
      <p className="text-sm text-gray-600 mb-4">
        Enter your IFTTT Webhook service key. You can find it at{" "}
        <a
          href="https://ifttt.com/maker_webhooks/settings"
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 underline"
        >
          IFTTT Webhooks Settings
        </a>
        .
      </p>

      <form
        data-step-form
        onSubmit={(e) => {
          e.preventDefault();
          onSave({ webhookKey });
        }}
      >
        <label className="block text-sm font-medium mb-1">Webhook Key</label>
        <input
          type="password"
          value={webhookKey}
          onChange={(e) => setWebhookKey(e.target.value)}
          className="w-full border rounded px-3 py-2 mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
          required
        />

        <button
          type="button"
          onClick={handleTest}
          disabled={!webhookKey || testing || saving}
          className="text-sm bg-gray-100 border px-3 py-1.5 rounded hover:bg-gray-200 disabled:opacity-50"
        >
          {testing ? "Testing..." : "Test key"}
        </button>

        {testResult && (
          <p className={`text-sm mt-2 ${testResult.ok ? "text-green-600" : "text-red-600"}`}>
            {testResult.message}
          </p>
        )}
      </form>
    </div>
  );
}
