interface HvacUnitCardProps {
  unitId: string;
  isExposed: boolean;
  hasActiveTimer: boolean;
}

export function HvacUnitCard({
  unitId,
  isExposed,
  hasActiveTimer,
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
          {unitId.replace(/_/g, " ")}
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
    </div>
  );
}
