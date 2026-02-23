const DELAY_PRESETS = [
  { label: "1m", value: 60 },
  { label: "2m", value: 120 },
  { label: "3m", value: 180 },
  { label: "5m", value: 300 },
  { label: "10m", value: 600 },
];

interface HvacUnitCardProps {
  unitId: string;
  isExposed: boolean;
  hasActiveTimer: boolean;
  displayName?: string;
  delaySeconds?: number;
  onDelayChange?: (unitId: string, delaySeconds: number) => void;
}

export function HvacUnitCard({
  unitId,
  isExposed,
  hasActiveTimer,
  displayName,
  delaySeconds,
  onDelayChange,
}: HvacUnitCardProps) {
  return (
    <div
      className={`rounded-lg border p-4 ${
        hasActiveTimer
          ? "border-orange-300 bg-orange-50"
          : isExposed
            ? "border-red-300 bg-red-50"
            : "border-green-300 bg-green-50"
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium truncate">
          {displayName ?? unitId.replace(/_/g, " ")}
        </span>
        <span
          className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
            hasActiveTimer
              ? "bg-orange-200 text-orange-800"
              : isExposed
                ? "bg-red-200 text-red-800"
                : "bg-green-200 text-green-800"
          }`}
        >
          {hasActiveTimer ? "TIMER" : isExposed ? "EXPOSED" : "SAFE"}
        </span>
      </div>
      {delaySeconds !== undefined && onDelayChange && (
        <div className="mt-2">
          <select
            className="text-xs border border-gray-300 rounded px-1 py-0.5 bg-white"
            value={delaySeconds}
            onChange={(e) => onDelayChange(unitId, Number(e.target.value))}
          >
            {DELAY_PRESETS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
          <span className="text-xs text-gray-500 ml-1">delay</span>
        </div>
      )}
    </div>
  );
}
