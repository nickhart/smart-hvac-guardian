import { useState, useEffect, useCallback } from "react";
import * as api from "../../lib/api";
import { StepNav } from "./StepNav";
import { Step1Account } from "./Step1Account";
import { Step2YoLink } from "./Step2YoLink";
import { Step3Sensors } from "./Step3Sensors";
import { Step4Zones } from "./Step4Zones";
import { Step5HvacUnits } from "./Step5HvacUnits";
import { Step6Ifttt } from "./Step6Ifttt";
import { Step7TestApplets } from "./Step7TestApplets";
import { Step8Review } from "./Step8Review";
import { Step9Activate } from "./Step9Activate";

const TOTAL_STEPS = 9;

const STEP_TITLES = [
  "",
  "Welcome",
  "YoLink Credentials",
  "Sensors",
  "HVAC Units",
  "Zones",
  "IFTTT Webhook",
  "Test Applets",
  "Review",
  "Activate",
];

interface OnboardingWizardProps {
  siteName: string;
  onComplete: () => void;
  onLogout: () => void;
}

export function OnboardingWizard({ siteName, onComplete, onLogout }: OnboardingWizardProps) {
  const [step, setStep] = useState(1);
  const [stepData, setStepData] = useState<Record<string, Record<string, unknown>>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Load saved progress
  useEffect(() => {
    api
      .getOnboardingSteps()
      .then((res) => {
        setStepData(res.stepData ?? {});
        // Resume at the highest completed step + 1
        const completedSteps = Object.keys(res.stepData ?? {}).map(Number);
        if (completedSteps.length > 0) {
          const maxStep = Math.max(...completedSteps);
          setStep(Math.min(maxStep + 1, TOTAL_STEPS));
        }
      })
      .catch(() => setError("Failed to load progress"))
      .finally(() => setLoading(false));
  }, []);

  const updateStepData = useCallback((stepNum: number, data: Record<string, unknown>) => {
    setStepData((prev) => ({ ...prev, [String(stepNum)]: data }));
  }, []);

  const saveAndNext = useCallback(
    async (stepNum: number, data: Record<string, unknown>) => {
      setSaving(true);
      setError("");
      try {
        await api.saveOnboardingStep(stepNum, data);
        updateStepData(stepNum, data);
        setStep((s) => Math.min(s + 1, TOTAL_STEPS));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save");
      } finally {
        setSaving(false);
      }
    },
    [updateStepData],
  );

  const goBack = useCallback(() => {
    setStep((s) => Math.max(s - 1, 1));
    setError("");
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-500">Loading setup...</p>
      </div>
    );
  }

  const currentData = stepData[String(step)] ?? {};

  const stepProps = {
    data: currentData,
    allStepData: stepData,
    onSave: (data: Record<string, unknown>) => saveAndNext(step, data),
    saving,
  };

  return (
    <div className="max-w-xl mx-auto px-4 py-6">
      <header className="flex items-center justify-between mb-2">
        <h1 className="text-lg font-semibold">{siteName}</h1>
        <button onClick={onLogout} className="text-sm text-gray-500 hover:text-gray-700">
          Logout
        </button>
      </header>

      {/* Progress bar */}
      <div className="mb-6">
        <div className="flex gap-1">
          {Array.from({ length: TOTAL_STEPS }, (_, i) => (
            <div
              key={i}
              className={`h-1 flex-1 rounded ${i < step ? "bg-primary-500" : "bg-gray-200"}`}
            />
          ))}
        </div>
        <p className="text-sm text-gray-600 mt-2">{STEP_TITLES[step]}</p>
      </div>

      {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

      <div className="bg-white rounded-lg shadow-md p-6">
        {step === 1 && <Step1Account {...stepProps} />}
        {step === 2 && <Step2YoLink {...stepProps} />}
        {step === 3 && <Step3Sensors {...stepProps} />}
        {step === 4 && <Step5HvacUnits {...stepProps} />}
        {step === 5 && <Step4Zones {...stepProps} />}
        {step === 6 && <Step6Ifttt {...stepProps} />}
        {step === 7 && <Step7TestApplets {...stepProps} />}
        {step === 8 && <Step8Review {...stepProps} />}
        {step === 9 && <Step9Activate onComplete={onComplete} />}

        {step < 9 && (
          <StepNav
            step={step}
            totalSteps={TOTAL_STEPS}
            onBack={goBack}
            onNext={() => {
              // Trigger form submission in the step component
              const form = document.querySelector<HTMLFormElement>("[data-step-form]");
              if (form) {
                form.requestSubmit();
              } else {
                // Step without a form — just advance
                setStep((s) => Math.min(s + 1, TOTAL_STEPS));
              }
            }}
            loading={saving}
          />
        )}
      </div>
    </div>
  );
}
