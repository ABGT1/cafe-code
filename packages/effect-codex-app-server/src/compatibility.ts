import * as Schema from "effect/Schema";

import { V2GetAccountResponse__PlanType } from "./_generated/schema.gen.ts";

const isKnownPlan = Schema.is(V2GetAccountResponse__PlanType);
// Plan identifiers are metadata, never authentication or entitlement authority.
// Bound the compatibility exception to identifier-shaped strings so malformed
// values still fail the generated schema instead of being repaired into success.
const FUTURE_PLAN_IDENTIFIER = /^[a-z][a-z0-9_-]{0,127}$/u;

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function normalizePlanRecord(value: unknown): unknown {
  const object = record(value);
  if (
    !object ||
    !Object.hasOwn(object, "planType") ||
    typeof object.planType !== "string" ||
    isKnownPlan(object.planType) ||
    !FUTURE_PLAN_IDENTIFIER.test(object.planType)
  ) {
    return value;
  }
  // Do not retain/echo a new upstream identifier in diagnostics or UI. The
  // existing unknown sentinel preserves valid account/quota data while the
  // allowlisted subscription formatter displays a generic subscription label.
  return { ...object, planType: "unknown" };
}

/**
 * Normalize only documented account-plan locations before strict decoding.
 *
 * https://learn.chatgpt.com/docs/app-server#auth-endpoints describes planType
 * on account/read, account/updated and the single/named quota snapshots. A new
 * subscription must not make those otherwise valid payloads undecodable. Keep
 * this adaptation outside generated schemas so generation remains reproducible
 * and every other field, discriminant and permission boundary stays strict.
 * This function is intentionally not a recursive "fix unknown enums" walker.
 */
export function normalizeCodexAccountPlanPayload(method: string, payload: unknown): unknown {
  const object = record(payload);
  if (!object) return payload;

  if (method === "account/updated") return normalizePlanRecord(object);

  if (method === "account/read") {
    const account = record(object.account);
    // Never change an unknown authentication variant, API key or Bedrock
    // payload into a ChatGPT account, even if it happens to contain planType.
    if (account?.type !== "chatgpt") return payload;
    const normalized = normalizePlanRecord(account);
    return normalized === account ? payload : { ...object, account: normalized };
  }

  if (method !== "account/rateLimits/read" && method !== "account/rateLimits/updated") {
    return payload;
  }
  const rateLimits = normalizePlanRecord(object.rateLimits);
  const buckets =
    method === "account/rateLimits/read" ? record(object.rateLimitsByLimitId) : undefined;
  let normalizedBuckets = buckets;
  if (buckets) {
    const entries = Object.entries(buckets).map(
      ([id, value]) => [id, normalizePlanRecord(value)] as const,
    );
    if (entries.some(([id, value]) => value !== buckets[id])) {
      // fromEntries defines own properties, including a literal __proto__ key;
      // no untrusted bucket name is assigned through an object prototype setter.
      normalizedBuckets = Object.fromEntries(entries);
    }
  }
  if (rateLimits === object.rateLimits && normalizedBuckets === buckets) return payload;
  return {
    ...object,
    ...(Object.hasOwn(object, "rateLimits") ? { rateLimits } : {}),
    ...(normalizedBuckets !== buckets ? { rateLimitsByLimitId: normalizedBuckets } : {}),
  };
}
