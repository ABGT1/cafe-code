import "../index.css";

import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import { formatCodexRateLimitPresentation } from "../lib/codexRateLimits";
import { ProviderAccountQuotaDetails } from "./ProviderAccountQuotaDetails";

describe("ProviderAccountQuotaDetails bounds", () => {
  let mounted: Awaited<ReturnType<typeof render>> | undefined;
  afterEach(async () => {
    await mounted?.unmount();
    mounted = undefined;
  });

  it.each(["compact", "popover", "settings"] as const)(
    "bounds all buckets in %s layout while keeping the reset count outside scrolling",
    async (layout) => {
      await page.viewport(1100, 800);
      const presentation = formatCodexRateLimitPresentation({
        checkedAt: "2026-09-29T00:00:00.000Z",
        rateLimits: {},
        rateLimitsByLimitId: Object.fromEntries(
          Array.from({ length: 20 }, (_, index) => [
            `quota-${index}`,
            {
              limitName: `Quota ${index}`,
              primary: { usedPercent: 25, windowDurationMins: 300 },
              credits: { hasCredits: false, unlimited: false, balance: "0" },
            },
          ]),
        ),
        rateLimitResetCredits: { availableCount: 0 },
      })!;
      mounted = await render(
        <div style={{ width: 300 }}>
          <ProviderAccountQuotaDetails presentation={presentation} layout={layout} />
        </div>,
      );
      const scroll = document.querySelector<HTMLElement>("[data-account-quota-scroll]")!;
      const count = page.getByText("Usage limit resets available: 0", { exact: true }).element();
      expect(document.querySelectorAll("[data-account-quota-bucket]")).toHaveLength(20);
      expect(scroll.scrollHeight).toBeGreaterThan(scroll.clientHeight);
      expect(scroll.clientHeight).toBeLessThanOrEqual(window.innerHeight * 0.4 + 1);
      expect(scroll.contains(count)).toBe(false);
      const countTop = count.getBoundingClientRect().top;
      scroll.scrollTop = scroll.scrollHeight;
      expect(count.getBoundingClientRect().top).toBe(countTop);
      expect(scroll.scrollWidth).toBeLessThanOrEqual(scroll.clientWidth + 1);
    },
  );

  it("keeps a reset-only settings window full width without inventing remaining usage", async () => {
    await page.viewport(1200, 800);
    const presentation = formatCodexRateLimitPresentation({
      checkedAt: "2026-09-29T00:00:00.000Z",
      rateLimits: {
        primary: { windowDurationMins: 10_080, resetsAt: 1_800_000_000 },
      },
    })!;
    mounted = await render(
      <div style={{ width: 1100 }}>
        <ProviderAccountQuotaDetails presentation={presentation} layout="settings" />
      </div>,
    );
    const window = document.querySelector<HTMLElement>('[data-account-quota-window="primary"]')!;
    const reset = window.querySelector("p")!;
    expect(reset.textContent).toContain("7d reset:");
    expect(reset.getBoundingClientRect().width).toBeCloseTo(
      window.getBoundingClientRect().width,
      0,
    );
    expect(window.textContent).not.toContain("% left");
    expect(document.querySelector("[data-account-quota-metadata]")).toBeNull();
  });
});
