import type { ServerProvider } from "@cafecode/contracts";
import { describe, expect, it } from "vitest";

import {
  codexAuthWithSubscriptionPlan,
  formatCodexSubscriptionLabel,
} from "./codexSubscription.ts";

describe("Codex subscription presentation", () => {
  it.each([
    ["plus", "ChatGPT Plus Subscription"],
    ["prolite", "ChatGPT Pro Subscription"],
    ["pro", "ChatGPT Pro (More) Subscription"],
    ["promax", "ChatGPT Pro (Max) Subscription"],
    ["free", "ChatGPT Free Subscription"],
    ["go", "ChatGPT Go Subscription"],
    ["business", "ChatGPT Business Subscription"],
    ["edu_plus", "ChatGPT Edu Plus Subscription"],
    ["edu_pro", "ChatGPT Edu Pro Subscription"],
    ["ent26", "ChatGPT Enterprise Subscription"],
  ])("formats the reported %s tier", (plan, label) => {
    expect(formatCodexSubscriptionLabel(plan)).toBe(label);
  });

  it.each([undefined, null, "unknown", "future_plan", "__proto__", "constructor", "toString", 20])(
    "does not guess or echo unsupported metadata %s",
    (plan) => {
      expect(formatCodexSubscriptionLabel(plan)).toBe("ChatGPT Subscription");
    },
  );

  const auth = {
    status: "authenticated",
    type: "chatgpt",
    label: "ChatGPT Pro (More) Subscription",
    email: "subscriber@example.com",
  } as const satisfies ServerProvider["auth"];

  it("updates only the label and preserves account identity", () => {
    expect(codexAuthWithSubscriptionPlan(auth, "prolite")).toEqual({
      ...auth,
      label: "ChatGPT Pro Subscription",
    });
    expect(codexAuthWithSubscriptionPlan(auth, "promax")).toEqual({
      ...auth,
      label: "ChatGPT Pro (Max) Subscription",
    });
    expect(codexAuthWithSubscriptionPlan(auth, "pro")).toBe(auth);
  });

  it.each(["ChatGPT Pro 5x Subscription", "ChatGPT Pro 20x Subscription"])(
    "retains cached legacy presentation %s until a current plan is reported",
    (label) => {
      const cachedAuth = { ...auth, label };
      expect(codexAuthWithSubscriptionPlan(cachedAuth, undefined)).toBe(cachedAuth);
      expect(codexAuthWithSubscriptionPlan(cachedAuth, null)).toBe(cachedAuth);
      expect(codexAuthWithSubscriptionPlan(cachedAuth, "promax")).toEqual({
        ...cachedAuth,
        label: "ChatGPT Pro (Max) Subscription",
      });
    },
  );

  it("keeps known presentation on missing sparse metadata, not on an unknown tier", () => {
    expect(codexAuthWithSubscriptionPlan(auth, undefined)).toBe(auth);
    expect(codexAuthWithSubscriptionPlan(auth, null)).toBe(auth);
    expect(codexAuthWithSubscriptionPlan(auth, "unknown")).toEqual({
      ...auth,
      label: "ChatGPT Subscription",
    });
    expect(codexAuthWithSubscriptionPlan(auth, "future_plan").label).toBe("ChatGPT Subscription");
  });

  it.each([
    { status: "unauthenticated", type: "chatgpt" },
    { status: "unknown", type: "chatgpt" },
    { status: "authenticated", type: "apiKey", label: "OpenAI API Key" },
    { status: "authenticated", type: "amazonBedrock", label: "Amazon Bedrock" },
    { status: "authenticated" },
  ] satisfies ServerProvider["auth"][])(
    "never promotes or relabels other authentication: %j",
    (other) => {
      expect(codexAuthWithSubscriptionPlan(other, "pro")).toBe(other);
      expect(codexAuthWithSubscriptionPlan(other, "promax")).toBe(other);
    },
  );
});
