import { useState } from "react";
import * as api from "../../lib/api";

interface StepProps {
  data: Record<string, unknown>;
  allStepData: Record<string, Record<string, unknown>>;
  onSave: (data: Record<string, unknown>) => void;
  saving: boolean;
}

export function Step2YoLink({ data, onSave, saving }: StepProps) {
  const [uaCid, setUaCid] = useState((data.uaCid as string) ?? "");
  const [secretKey, setSecretKey] = useState((data.secretKey as string) ?? "");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await api.testYoLinkCredentials(uaCid, secretKey);
      setTestResult({ ok: res.status === "ok", message: res.message });
    } catch (err) {
      setTestResult({ ok: false, message: err instanceof Error ? err.message : "Test failed" });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div>
      <h2 className="text-lg font-semibold mb-2">YoLink Credentials</h2>
      <p className="text-sm text-gray-600 mb-4">
        Enter your YoLink UACID and Secret Key. You can find these in the YoLink developer portal.
      </p>

      <form
        data-step-form
        onSubmit={(e) => {
          e.preventDefault();
          onSave({ uaCid, secretKey });
        }}
      >
        <label className="block text-sm font-medium mb-1">UA-CID</label>
        <input
          type="text"
          value={uaCid}
          onChange={(e) => setUaCid(e.target.value)}
          className="w-full border rounded px-3 py-2 mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="ua_xxxxxxxx"
          required
        />

        <label className="block text-sm font-medium mb-1">Secret Key</label>
        <input
          type="password"
          value={secretKey}
          onChange={(e) => setSecretKey(e.target.value)}
          className="w-full border rounded px-3 py-2 mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
          required
        />

        <button
          type="button"
          onClick={handleTest}
          disabled={!uaCid || !secretKey || testing || saving}
          className="text-sm bg-gray-100 border px-3 py-1.5 rounded hover:bg-gray-200 disabled:opacity-50"
        >
          {testing ? "Testing..." : "Test credentials"}
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
