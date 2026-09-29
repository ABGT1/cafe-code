import { describe, expect, it } from "vitest";
import * as Schema from "effect/Schema";
import * as CodexSchema from "effect-codex-app-server/schema";

import { codexAppServerRateLimitsToServer, parseCodexRateLimitUpdate } from "./codexRateLimits.ts";

const decodeRateLimitsResponse = Schema.decodeUnknownSync(
  CodexSchema.V2GetAccountRateLimitsResponse,
);

describe("codexAppServerRateLimitsToServer", () => {
  it("preserves independent named quota metadata, zero usage and explicit nulls from full reads", () => {
    const response = decodeRateLimitsResponse({
      rateLimits: {
        limitId: "codex",
        normalModelSlug: null,
        credits: { hasCredits: true, unlimited: false, balance: "9.99" },
      },
      rateLimitsByLimitId: {
        reserve: {
          limitId: "reserve",
          limitName: "Reserve quota",
          normalModelSlug: "gpt-5.6-luna",
          planType: "pro",
          primary: { usedPercent: 0, windowDurationMins: 0, resetsAt: 0 },
          secondary: null,
          credits: { hasCredits: false, unlimited: false, balance: "0" },
          rateLimitReachedType: "workspace_member_credits_depleted",
          spendControlReached: false,
          individualLimit: null,
        },
        unavailable: { normalModelSlug: null, credits: null, rateLimitReachedType: null },
        omitted: { limitName: "Metadata only" },
      },
      rateLimitResetCredits: { availableCount: 0, credits: null },
    });
    expect(codexAppServerRateLimitsToServer(response, "2026-09-29T00:00:00.000Z")).toEqual({
      ...response,
      checkedAt: "2026-09-29T00:00:00.000Z",
    });
  });
});

describe("parseCodexRateLimitUpdate", () => {
  it("maps the documented sparse rolling notification into the canonical Codex bucket", () => {
    expect(
      parseCodexRateLimitUpdate({
        rateLimits: {
          limitId: "codex",
          planType: "pro",
          normalModelSlug: "gpt-6-astra",
          primary: {
            usedPercent: 1,
            windowDurationMins: 10_080,
            resetsAt: 1_786_400_000,
          },
          secondary: null,
        },
      }),
    ).toEqual({
      limitId: "codex",
      snapshot: {
        limitId: "codex",
        planType: "pro",
        normalModelSlug: "gpt-6-astra",
        primary: {
          usedPercent: 1,
          windowDurationMins: 10_080,
          resetsAt: 1_786_400_000,
        },
      },
    });
  });

  it("defaults legacy single-bucket notifications to codex and omits nullable metadata", () => {
    expect(
      parseCodexRateLimitUpdate({
        rateLimits: {
          limitId: null,
          planType: null,
          normalModelSlug: null,
          primary: { usedPercent: 12, windowDurationMins: null, resetsAt: null },
        },
      }),
    ).toEqual({
      limitId: "codex",
      snapshot: {
        limitId: "codex",
        primary: { usedPercent: 12 },
      },
    });
  });

  it("preserves named-bucket zero values and does not invent omitted account credits", () => {
    expect(
      parseCodexRateLimitUpdate({
        rateLimits: {
          limitId: "reserve",
          normalModelSlug: "gpt-5.6-luna",
          primary: { usedPercent: 0, windowDurationMins: 0, resetsAt: 0 },
          credits: { hasCredits: false, unlimited: false, balance: "0" },
          rateLimitReachedType: "rate_limit_reached",
          spendControlReached: false,
        },
      }),
    ).toEqual({
      limitId: "reserve",
      snapshot: {
        limitId: "reserve",
        normalModelSlug: "gpt-5.6-luna",
        primary: { usedPercent: 0, windowDurationMins: 0, resetsAt: 0 },
        credits: { hasCredits: false, unlimited: false, balance: "0" },
        rateLimitReachedType: "rate_limit_reached",
        spendControlReached: false,
      },
    });
    expect(
      parseCodexRateLimitUpdate({
        rateLimits: { limitId: "reserve", normalModelSlug: "gpt-5.6-luna" },
      })?.snapshot,
    ).not.toHaveProperty("credits");
    expect(
      parseCodexRateLimitUpdate({
        rateLimits: { limitId: "reserve", normalModelSlug: null, credits: null },
      }),
    ).toBeNull();
  });

  it("normalizes only a well-formed future plan while keeping malformed notifications invalid", () => {
    expect(
      parseCodexRateLimitUpdate({
        rateLimits: { limitId: "reserve", planType: "pro_future", primary: { usedPercent: 0 } },
      }),
    ).toEqual({
      limitId: "reserve",
      snapshot: { limitId: "reserve", planType: "unknown", primary: { usedPercent: 0 } },
    });
    for (const planType of [12, {}, [], "future plan", "", "a".repeat(129)]) {
      expect(
        parseCodexRateLimitUpdate({ rateLimits: { planType, primary: { usedPercent: 0 } } }),
      ).toBeNull();
    }
    expect(
      parseCodexRateLimitUpdate({
        rateLimits: { planType: "pro_future", normalModelSlug: {}, primary: { usedPercent: 0 } },
      }),
    ).toBeNull();
  });

  it("rejects malformed and empty rolling updates", () => {
    expect(parseCodexRateLimitUpdate(null)).toBeNull();
    expect(parseCodexRateLimitUpdate({})).toBeNull();
    expect(parseCodexRateLimitUpdate({ rateLimits: { primary: null } })).toBeNull();
    expect(parseCodexRateLimitUpdate({ rateLimits: { primary: { usedPercent: "1" } } })).toBeNull();
  });
});
