interface SensorCardProps {
  sensorId: string;
  state: string;
  isOffline: boolean;
  displayName?: string;
}

export function SensorCard({ sensorId, state, isOffline, displayName }: SensorCardProps) {
  const isOpen = state === "open";

  return (
    <div
      className={`rounded-lg border p-4 ${
        isOffline
          ? "border-yellow-300 bg-yellow-50"
          : isOpen
            ? "border-red-300 bg-red-50"
            : "border-green-300 bg-green-50"
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium truncate">
          {displayName ?? sensorId.replace(/_/g, " ")}
        </span>
        <span
          className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
            isOffline
              ? "bg-yellow-200 text-yellow-800"
              : isOpen
                ? "bg-red-200 text-red-800"
                : "bg-green-200 text-green-800"
          }`}
        >
          {isOffline ? "OFFLINE" : state.toUpperCase()}
        </span>
      </div>
    </div>
  );
}
