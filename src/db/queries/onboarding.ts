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

/**
 * Drop a tenant's wizard drafts. They hold the YoLink and IFTTT keys as typed,
 * in plaintext, so they must not outlive onboarding: once activation has
 * stored those keys encrypted, the drafts are only a second, unencrypted copy.
 */
export async function deleteOnboardingProgress(db: Database, tenantId: string): Promise<void> {
  await db.delete(onboardingProgress).where(eq(onboardingProgress.tenantId, tenantId));
}
