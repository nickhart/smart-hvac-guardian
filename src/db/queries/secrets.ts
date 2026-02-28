import { eq } from "drizzle-orm";
import type { Database } from "../client.js";
import { tenantSecrets } from "../schema.js";
import { encrypt, decrypt } from "../../utils/crypto.js";

export interface TenantSecretsPlain {
  yolinkUaCid: string;
  yolinkSecretKey: string;
  iftttWebhookKey: string;
  webhookSecret?: string;
}

export async function setTenantSecrets(
  db: Database,
  tenantId: string,
  secrets: TenantSecretsPlain,
  masterKeyHex?: string,
): Promise<void> {
  const [yolinkUaCidEnc, yolinkSecretKeyEnc, iftttWebhookKeyEnc] = await Promise.all([
    encrypt(secrets.yolinkUaCid, masterKeyHex),
    encrypt(secrets.yolinkSecretKey, masterKeyHex),
    encrypt(secrets.iftttWebhookKey, masterKeyHex),
  ]);

  const webhookSecretEnc = secrets.webhookSecret
    ? await encrypt(secrets.webhookSecret, masterKeyHex)
    : undefined;

  await db
    .insert(tenantSecrets)
    .values({
      tenantId,
      yolinkUaCidEnc,
      yolinkSecretKeyEnc,
      iftttWebhookKeyEnc,
      webhookSecretEnc,
      keyVersion: 1,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: tenantSecrets.tenantId,
      set: {
        yolinkUaCidEnc,
        yolinkSecretKeyEnc,
        iftttWebhookKeyEnc,
        ...(webhookSecretEnc !== undefined ? { webhookSecretEnc } : {}),
        keyVersion: 1,
        updatedAt: new Date(),
      },
    });
}

export async function getTenantSecrets(
  db: Database,
  tenantId: string,
  masterKeyHex?: string,
): Promise<TenantSecretsPlain | undefined> {
  const row = await db.query.tenantSecrets.findFirst({
    where: eq(tenantSecrets.tenantId, tenantId),
  });

  if (!row || !row.yolinkUaCidEnc || !row.yolinkSecretKeyEnc || !row.iftttWebhookKeyEnc) {
    return undefined;
  }

  const [yolinkUaCid, yolinkSecretKey, iftttWebhookKey] = await Promise.all([
    decrypt(row.yolinkUaCidEnc, masterKeyHex),
    decrypt(row.yolinkSecretKeyEnc, masterKeyHex),
    decrypt(row.iftttWebhookKeyEnc, masterKeyHex),
  ]);

  const webhookSecret = row.webhookSecretEnc
    ? await decrypt(row.webhookSecretEnc, masterKeyHex)
    : undefined;

  return { yolinkUaCid, yolinkSecretKey, iftttWebhookKey, webhookSecret };
}
