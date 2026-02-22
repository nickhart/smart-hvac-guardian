import { useState } from "react";
import { setSystemToggle } from "../lib/api";

interface SystemToggleProps {
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
}

export function SystemToggle({ enabled, onToggle }: SystemToggleProps) {
  const [loading, setLoading] = useState(false);

  async function handleToggle() {
    setLoading(true);
    try {
      const result = await setSystemToggle(!enabled);
      onToggle(result.enabled);
    } catch {
      // revert on error
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <span className="text-sm font-medium">System</span>
      <button
        onClick={handleToggle}
        disabled={loading}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 ${
          enabled ? "bg-green-600" : "bg-gray-300"
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
            enabled ? "translate-x-6" : "translate-x-1"
          }`}
        />
      </button>
      <span className={`text-xs font-semibold ${enabled ? "text-green-700" : "text-red-600"}`}>
        {enabled ? "ON" : "OFF"}
      </span>
    </div>
  );
}
