import { describe, expect, it } from "vitest";
import * as Schema from "effect/Schema";

import { normalizeCodexAccountPlanPayload } from "./compatibility.ts";
import * as Codex from "./schema.ts";

const decodeAccount = Schema.decodeUnknownSync(Codex.V2GetAccountResponse);
const decodeQuotas = Schema.decodeUnknownSync(Codex.V2GetAccountRateLimitsResponse);
const decodeAccountUpdate = Schema.decodeUnknownSync(Codex.V2AccountUpdatedNotification);
const decodeQuotaUpdate = Schema.decodeUnknownSync(Codex.V2AccountRateLimitsUpdatedNotification);
const isAccount = Schema.is(Codex.V2GetAccountResponse);
const isQuotas = Schema.is(Codex.V2GetAccountRateLimitsResponse);
const isAccountUpdate = Schema.is(Codex.V2AccountUpdatedNotification);

describe("Codex subscription metadata compatibility", () => {
  it("preserves valid account data without guessing a new plan's entitlements", () => {
    const payload = {
      account: { type: "chatgpt", email: null, planType: "future_plan" },
      requiresOpenaiAuth: true,
    };
    const normalized = normalizeCodexAccountPlanPayload("account/read", payload);
    expect(decodeAccount(normalized)).toEqual({
      ...payload,
      account: { ...payload.account, planType: "unknown" },
    });
    expect(payload.account.planType).toBe("future_plan");
    expect(normalizeCodexAccountPlanPayload("account/read", normalized)).toBe(normalized);
  });

  it("normalizes every named quota and preserves zero and absent values", () => {
    const payload = {
      rateLimits: { planType: "future_plan", primary: { usedPercent: 0 } },
      rateLimitsByLimitId: {
        codex: {
          planType: "future_plan",
          credits: { hasCredits: false, unlimited: false, balance: "0" },
        },
        other: { planType: "future_plan", secondary: null },
        known: { planType: "promax" },
        unavailable: { planType: null },
      },
      rateLimitResetCredits: { availableCount: 0 },
    };
    const normalized = normalizeCodexAccountPlanPayload("account/rateLimits/read", payload);
    expect(decodeQuotas(normalized)).toEqual({
      ...payload,
      rateLimits: { ...payload.rateLimits, planType: "unknown" },
      rateLimitsByLimitId: {
        ...payload.rateLimitsByLimitId,
        codex: { ...payload.rateLimitsByLimitId.codex, planType: "unknown" },
        other: { ...payload.rateLimitsByLimitId.other, planType: "unknown" },
      },
    });
    expect(normalizeCodexAccountPlanPayload("account/rateLimits/read", {})).toEqual({});
  });

  it("adapts both notification paths without touching unrelated metadata", () => {
    const account = normalizeCodexAccountPlanPayload("account/updated", {
      authMode: "chatgpt",
      planType: "future_plan",
    });
    expect(decodeAccountUpdate(account)).toEqual({
      authMode: "chatgpt",
      planType: "unknown",
    });
    const quota = normalizeCodexAccountPlanPayload("account/rateLimits/updated", {
      rateLimits: { planType: "future_plan", primary: { usedPercent: 72 } },
    });
    expect(decodeQuotaUpdate(quota)).toEqual({
      rateLimits: { planType: "unknown", primary: { usedPercent: 72 } },
    });
    const unrelated = { planType: "future_plan", nested: { planType: "future_plan" } };
    expect(normalizeCodexAccountPlanPayload("thread/read", unrelated)).toBe(unrelated);
  });

  it.each([undefined, null, 1, {}, [], "", " ", "bad plan", "bad\nplan", "x".repeat(129)])(
    "does not repair malformed required plan metadata: %j",
    (planType) => {
      const raw = { account: { type: "chatgpt", email: null, planType }, requiresOpenaiAuth: true };
      expect(isAccount(normalizeCodexAccountPlanPayload("account/read", raw))).toBe(false);
    },
  );

  it("retains authentication and quota validation outside the plan exception", () => {
    for (const raw of [
      {
        account: { type: "futureAuth", email: null, planType: "future_plan" },
        requiresOpenaiAuth: true,
      },
      {
        account: { type: "chatgpt", email: null, planType: "future_plan" },
        requiresOpenaiAuth: "yes",
      },
      { account: { type: "chatgpt", planType: "future_plan" }, requiresOpenaiAuth: true },
    ]) {
      expect(isAccount(normalizeCodexAccountPlanPayload("account/read", raw))).toBe(false);
    }
    const raw = { rateLimits: { planType: "future_plan", primary: { usedPercent: "12" } } };
    expect(isQuotas(normalizeCodexAccountPlanPayload("account/rateLimits/read", raw))).toBe(false);
    const badMode = { authMode: "futureAuth", planType: "future_plan" };
    expect(isAccountUpdate(normalizeCodexAccountPlanPayload("account/updated", badMode))).toBe(
      false,
    );
  });

  it("preserves inert bucket keys without prototype mutation", () => {
    const payload = {
      rateLimits: {},
      rateLimitsByLimitId: Object.fromEntries([["__proto__", { planType: "future_plan" }]]),
    };
    const result = normalizeCodexAccountPlanPayload(
      "account/rateLimits/read",
      payload,
    ) as typeof payload;
    expect(Object.hasOwn(result.rateLimitsByLimitId, "__proto__")).toBe(true);
    expect(result.rateLimitsByLimitId["__proto__"]).toEqual({ planType: "unknown" });
    expect(Object.getPrototypeOf(result.rateLimitsByLimitId)).toBe(Object.prototype);
  });
});
