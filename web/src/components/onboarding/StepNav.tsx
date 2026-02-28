interface StepNavProps {
  step: number;
  totalSteps: number;
  onBack: () => void;
  onNext: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  loading?: boolean;
}

export function StepNav({
  step,
  totalSteps,
  onBack,
  onNext,
  nextLabel = "Next",
  nextDisabled = false,
  loading = false,
}: StepNavProps) {
  return (
    <div className="flex items-center justify-between mt-6 pt-4 border-t">
      <button
        type="button"
        onClick={onBack}
        disabled={step <= 1 || loading}
        className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 disabled:opacity-30"
      >
        Back
      </button>
      <span className="text-xs text-gray-400">
        Step {step} of {totalSteps}
      </span>
      <button
        type="button"
        onClick={onNext}
        disabled={nextDisabled || loading}
        className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? "..." : nextLabel}
      </button>
    </div>
  );
}
