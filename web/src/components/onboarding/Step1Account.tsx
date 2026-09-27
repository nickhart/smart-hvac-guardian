interface StepProps {
  data: Record<string, unknown>;
  allStepData: Record<string, Record<string, unknown>>;
  onSave: (data: Record<string, unknown>) => void;
  saving: boolean;
}

export function Step1Account({ onSave }: StepProps) {
  return (
    <div>
      <h2 className="text-lg font-semibold mb-2">Welcome to HVAC Guardian</h2>
      <p className="text-sm text-gray-600 mb-4">
        This wizard will guide you through setting up your smart HVAC protection system. You&apos;ll
        configure your YoLink sensors, define zones, set up HVAC units, and connect everything via
        IFTTT.
      </p>

      <div className="space-y-3 text-sm text-gray-700">
        <p>Here&apos;s what you&apos;ll need:</p>
        <ul className="list-disc list-inside space-y-1 ml-2">
          <li>YoLink API credentials (UA-CID and Secret Key)</li>
          <li>IFTTT Webhook key</li>
          <li>Knowledge of your property&apos;s layout (rooms, doors, HVAC units)</li>
        </ul>
      </div>

      <form
        data-step-form
        onSubmit={(e) => {
          e.preventDefault();
          onSave({ completed: true });
        }}
      >
        {/* No fields needed for step 1 */}
      </form>
    </div>
  );
}
