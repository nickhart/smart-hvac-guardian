import { eq } from "drizzle-orm";
import type { Database } from "../client.js";
import { onboardingProgress } from "../schema.js";

export type StepData = Record<string, unknown>;

export async function getOnboardingProgress(
  db: Database,
  tenantId: string,
): Promise<Record<string, StepData> | undefined> {
  const row = await db.query.onboardingProgress.findFirst({
    where: eq(onboardingProgress.tenantId, tenantId),
  });
  if (!row) return undefined;
  return row.stepData as Record<string, StepData>;
}

export async function saveOnboardingStep(
  db: Database,
  tenantId: string,
  stepNumber: number,
  data: StepData,
): Promise<void> {
  const existing = await getOnboardingProgress(db, tenantId);
  const stepData = { ...(existing ?? {}), [String(stepNumber)]: data };

  await db
    .insert(onboardingProgress)
    .values({ tenantId, stepData, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: onboardingProgress.tenantId,
      set: { stepData, updatedAt: new Date() },
    });
}
