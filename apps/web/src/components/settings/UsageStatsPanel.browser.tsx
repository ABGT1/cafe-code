import "../../index.css";

import { page } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { ProviderDriverKind, type UsageStatsGetResult } from "@cafecode/contracts";

import { applyInterfaceScalePercent } from "../../interfaceScale";
import { resetUsageStatsDetailResourceForTests } from "../stats/usageStatsDetailResource";
import { UsageCostContent } from "./UsageCostSection";
import { UsageStatsPanel } from "./UsageStatsPanel";

const usageHarness = vi.hoisted(() => {
  let detail: unknown;
  let snapshot: unknown;
  const updateSettings = vi.fn();
  const getUsageStats = vi.fn(async () => detail);
  const subscribeConnectionOpened = vi.fn(() => () => undefined);
  const subscribeUsageStats = vi.fn((nextListener: (event: unknown) => void) => {
    nextListener(snapshot);
    return () => undefined;
  });

  return {
    updateSettings,
    getUsageStats,
    subscribeConnectionOpened,
    subscribeUsageStats,
    reset(nextDetail: unknown, nextSnapshot: unknown) {
      detail = nextDetail;
      snapshot = nextSnapshot;
      updateSettings.mockReset();
      getUsageStats.mockClear();
      subscribeConnectionOpened.mockClear();
      subscribeUsageStats.mockClear();
    },
  };
});

vi.mock("../../environments/runtime", () => ({
  getPrimaryEnvironmentConnection: () => ({
    client: {
      server: {
        getUsageStats: usageHarness.getUsageStats,
        subscribeUsageStats: usageHarness.subscribeUsageStats,
      },
      subscribeConnectionOpened: usageHarness.subscribeConnectionOpened,
    },
  }),
}));

vi.mock("../../hooks/useSettings", () => ({
  useSettings: (
    selector?: (settings: {
      usageStatsEnabled: boolean;
      modelPricingOverrides: undefined;
    }) => unknown,
  ) => {
    const settings = { usageStatsEnabled: true, modelPricingOverrides: undefined };
    return selector ? selector(settings) : settings;
  },
  useUpdateSettings: () => ({ updateSettings: usageHarness.updateSettings }),
}));

const totals = {
  generatingMs: 3_661_000,
  inputTokens: 2_750_000,
  cachedInputTokens: 1_250_000,
  cacheWriteInputTokens: 250_000,
  outputTokens: 250_000,
  reasoningOutputTokens: 50_000,
  userMessages: 42,
};

const snapshot = {
  totals,
  today: {
    day: "2026-07-21",
    generatingMs: 61_000,
    inputTokens: 325_000,
    cachedInputTokens: 125_000,
    cacheWriteInputTokens: 25_000,
    outputTokens: 25_000,
    reasoningOutputTokens: 5_000,
    userMessages: 4,
  },
  activeSessionCount: 0,
  collectionEnabled: true,
  asOfMs: Date.now(),
};

function createUsageDetail(): UsageStatsGetResult {
  return {
    ...snapshot,
    days: [snapshot.today],
    tokenBreakdown: [
      {
        provider: "codex",
        model: "gpt-5.6-codex",
        inputTokens: 1_500_000,
        cachedInputTokens: 750_000,
        cacheWriteInputTokens: 100_000,
        outputTokens: 100_000,
        reasoningOutputTokens: 20_000,
      },
      {
        provider: "codex",
        model: "gpt-5.6-codex-mini",
        inputTokens: 500_000,
        cachedInputTokens: 250_000,
        cacheWriteInputTokens: 50_000,
        outputTokens: 25_000,
        reasoningOutputTokens: 5_000,
      },
      {
        provider: "claudeAgent",
        model: "claude-opus-5",
        inputTokens: 750_000,
        cachedInputTokens: 250_000,
        cacheWriteInputTokens: 100_000,
        outputTokens: 75_000,
        reasoningOutputTokens: 25_000,
      },
    ],
  } as unknown as UsageStatsGetResult;
}

/** Synthetic long-running usage keeps the layout checks independent of providers. */
function createBillionScaleUsageDetail(): UsageStatsGetResult {
  const baseline = createUsageDetail();
  const scale = 1_000;
  const scaledToday = {
    ...baseline.today,
    generatingMs: baseline.today.generatingMs * scale,
    inputTokens: baseline.today.inputTokens * scale,
    cachedInputTokens: baseline.today.cachedInputTokens * scale,
    cacheWriteInputTokens: baseline.today.cacheWriteInputTokens * scale,
    outputTokens: baseline.today.outputTokens * scale,
    reasoningOutputTokens: baseline.today.reasoningOutputTokens * scale,
    userMessages: baseline.today.userMessages * scale,
  };
  return {
    ...baseline,
    totals: {
      generatingMs: baseline.totals.generatingMs * scale,
      inputTokens: baseline.totals.inputTokens * scale,
      cachedInputTokens: baseline.totals.cachedInputTokens * scale,
      cacheWriteInputTokens: baseline.totals.cacheWriteInputTokens * scale,
      outputTokens: baseline.totals.outputTokens * scale,
      reasoningOutputTokens: baseline.totals.reasoningOutputTokens * scale,
      userMessages: baseline.totals.userMessages * scale,
    },
    today: scaledToday,
    days: Array.from({ length: 7 }, (_, index) => ({
      ...scaledToday,
      day: `2026-07-${15 + index}` as typeof scaledToday.day,
    })),
    tokenBreakdown: baseline.tokenBreakdown.map((entry) => ({
      ...entry,
      inputTokens: entry.inputTokens * scale,
      cachedInputTokens: entry.cachedInputTokens * scale,
      cacheWriteInputTokens: entry.cacheWriteInputTokens * scale,
      outputTokens: entry.outputTokens * scale,
      reasoningOutputTokens: entry.reasoningOutputTokens * scale,
    })),
  };
}

function requiredElement(selector: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(selector);
  expect(element).not.toBeNull();
  return element!;
}

function displayedRawCount(id: string): number {
  const text = requiredElement(`[data-usage-token-full="composition-${id}"]`).textContent ?? "";
  const numeric = text.match(/[\d,]+/)?.[0];
  expect(numeric).toBeDefined();
  return Number(numeric!.replaceAll(",", ""));
}

function expectFullBeforeCompact(context: string): void {
  const full = requiredElement(`[data-usage-token-full="${context}"]`);
  const compact = requiredElement(`[data-usage-token-compact="${context}"]`);
  expect(full.compareDocumentPosition(compact) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  expect(Number.parseFloat(getComputedStyle(full).fontSize)).toBeGreaterThan(
    Number.parseFloat(getComputedStyle(compact).fontSize),
  );
  expect(compact.getAttribute("aria-hidden")).toBe("true");
}

function expectNoHorizontalOverflow(element: HTMLElement): void {
  expect(element.scrollWidth).toBeLessThanOrEqual(element.clientWidth + 1);
}

function expectCompositionNumbersOnOneLine(): void {
  for (const id of ["processed", "cached", "uncached", "output"]) {
    const figure = requiredElement(`[data-usage-token-full="composition-${id}"]`);
    const numericText = Array.from(figure.childNodes).find(
      (node) => node.nodeType === Node.TEXT_NODE && /^[\d,]+/.test(node.textContent ?? ""),
    );
    expect(numericText).toBeDefined();
    const digitLength = numericText!.textContent!.match(/^[\d,]+/)![0].length;
    // Measure the digits themselves: the supporting word "tokens" may wrap,
    // but a billion-scale counter must remain readable as one complete number.
    const range = document.createRange();
    range.setStart(numericText!, 0);
    range.setEnd(numericText!, digitLength);
    expect(Array.from(range.getClientRects()).filter((rect) => rect.width > 0)).toHaveLength(1);
    expectNoHorizontalOverflow(figure);
  }
}

function expectOverviewStacked(): void {
  const overview = requiredElement("[data-usage-cost-overview]");
  const hero = overview.children[0]!.getBoundingClientRect();
  const chart = overview.children[1]!.getBoundingClientRect();
  expect(chart.top).toBeGreaterThanOrEqual(hero.bottom);
  expect(Math.abs(chart.left - hero.left)).toBeLessThanOrEqual(1);
}

function settleLayoutCountersImmediately(): void {
  const matchMedia = window.matchMedia.bind(window);
  // Geometry cases exercise the supported reduced-motion path so unrelated
  // odometer timing cannot change measured text widths. Other media queries
  // and the existing intermediate-counter animation test remain unaffected.
  vi.spyOn(window, "matchMedia").mockImplementation((query) => {
    const media = matchMedia(query);
    if (query === "(prefers-reduced-motion: reduce)") {
      Object.defineProperty(media, "matches", { value: true });
    }
    return media;
  });
}

describe("UsageStatsPanel", () => {
  let mounted:
    | (Awaited<ReturnType<typeof render>> & {
        cleanup?: () => Promise<void>;
        unmount?: () => Promise<void>;
      })
    | null = null;
  let originalViewport = { height: window.innerHeight, width: window.innerWidth };
  let originalRootFontSize = "";
  let originalRootFontPriority = "";

  beforeEach(() => {
    originalViewport = { height: window.innerHeight, width: window.innerWidth };
    originalRootFontSize = document.documentElement.style.getPropertyValue("font-size");
    originalRootFontPriority = document.documentElement.style.getPropertyPriority("font-size");
    resetUsageStatsDetailResourceForTests();
    usageHarness.reset(createUsageDetail(), snapshot);
  });

  afterEach(async () => {
    const teardown = mounted?.cleanup ?? mounted?.unmount;
    await teardown?.call(mounted).catch(() => {});
    mounted = null;
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    if (originalRootFontSize) {
      document.documentElement.style.setProperty(
        "font-size",
        originalRootFontSize,
        originalRootFontPriority,
      );
    } else {
      document.documentElement.style.removeProperty("font-size");
    }
    if (
      window.innerWidth !== originalViewport.width ||
      window.innerHeight !== originalViewport.height
    ) {
      await page.viewport(originalViewport.width, originalViewport.height);
    }
  });

  it("renders stored provider and model token attribution with earlier usage separated", async () => {
    mounted = await render(<UsageStatsPanel />);

    await expect.element(page.getByText("Tokens by provider and model")).toBeVisible();
    await expect.element(page.getByText("200,000 attributed")).toBeVisible();
    // Provider and model names now appear in the Cost section as well, so these
    // match more than once. Both are legitimate renders and the assertion is
    // only that the name appears; the section-specific strings above and below
    // are what actually pin this test to the attribution list.
    await expect.element(page.getByText("Codex", { exact: true }).first()).toBeVisible();
    await expect.element(page.getByText("Claude", { exact: true }).first()).toBeVisible();
    await expect.element(page.getByText("gpt-5.6-codex", { exact: true }).first()).toBeVisible();
    await expect
      .element(page.getByText("gpt-5.6-codex-mini", { exact: true }).first())
      .toBeVisible();
    await expect.element(page.getByText("claude-opus-5", { exact: true }).first()).toBeVisible();
    await expect.element(page.getByText("Earlier usage")).toBeVisible();
    await expect
      .element(page.getByText("Recorded before provider and model attribution"))
      .toBeVisible();
    expect(usageHarness.getUsageStats).toHaveBeenCalledTimes(1);
    expect(usageHarness.subscribeConnectionOpened).toHaveBeenCalledTimes(1);
    expect(usageHarness.subscribeUsageStats).toHaveBeenCalledTimes(1);
  });

  it("renders a quiet empty state before attributed tokens exist", async () => {
    usageHarness.reset(
      {
        ...snapshot,
        totals: { ...totals, outputTokens: 0 },
        days: [],
        tokenBreakdown: [],
      },
      { ...snapshot, totals: { ...totals, outputTokens: 0 } },
    );

    mounted = await render(<UsageStatsPanel />);

    await expect
      .element(
        page.getByText(
          "Provider and model attribution will appear after output tokens are recorded.",
        ),
      )
      .toBeVisible();
  });

  it("labels monetary estimates as USD and makes full token counts primary", async () => {
    mounted = await render(<UsageCostContent usage={createUsageDetail()} />);

    const hero = requiredElement('[data-usage-cost-hero-value="true"]');
    expect(hero.textContent).toMatch(/^\$[\d,.]+ USD\*/);
    expect(requiredElement('[data-usage-cost-chart-label="true"]').textContent).toContain("USD");

    const providerCosts = Array.from(
      document.querySelectorAll<HTMLElement>('[data-usage-provider-cost-value="true"]'),
    );
    expect(providerCosts).toHaveLength(2);
    expect(providerCosts.every((entry) => /\$[\d,.]+ USD/.test(entry.textContent ?? ""))).toBe(
      true,
    );

    expect(requiredElement('[data-usage-composition-value="cache-savings"]').textContent).toMatch(
      /\$[\d,.]+ USD/,
    );
    expect(requiredElement('[data-usage-cost-quality-cache-savings="true"]').textContent).toMatch(
      /\$[\d,.]+ USD/,
    );
    const modelCosts = Array.from(
      document.querySelectorAll<HTMLElement>('[data-usage-model-cost-value="true"]'),
    );
    expect(modelCosts).toHaveLength(3);
    expect(modelCosts.every((entry) => /\$[\d,.]+ USD/.test(entry.textContent ?? ""))).toBe(true);

    expect(requiredElement('[data-usage-token-full="range"]').textContent).toContain(
      "350,000 tokens in range",
    );
    expect(requiredElement('[data-usage-token-compact="range"]').textContent).toBe("350K");
    expectFullBeforeCompact("range");

    const providerFullCounts = Array.from(
      document.querySelectorAll<HTMLElement>('[data-usage-token-full="provider"]'),
    );
    const providerCompacts = Array.from(
      document.querySelectorAll<HTMLElement>('[data-usage-token-compact="provider"]'),
    );
    expect(providerFullCounts).toHaveLength(2);
    expect(providerCompacts).toHaveLength(2);
    expect(
      providerFullCounts.every((entry) => /\d{1,3}(,\d{3})+ tokens/.test(entry.textContent ?? "")),
    ).toBe(true);
    expect(providerCompacts.every((entry) => /[KM]/.test(entry.textContent ?? ""))).toBe(true);
    for (const figure of document.querySelectorAll<HTMLElement>(
      '[data-usage-token-figure="provider"]',
    )) {
      const children = figure.querySelectorAll<HTMLElement>(
        "[data-usage-token-full], [data-usage-token-compact]",
      );
      expect(children[0]?.dataset.usageTokenFull).toBe("provider");
      expect(children[1]?.dataset.usageTokenCompact).toBe("provider");
    }

    const aggregateExpectations = {
      processed: ["3,000,000 tokens", "3.00M"],
      cached: ["1,250,000 tokens", "1.25M"],
      uncached: ["1,250,000 tokens", "1.25M"],
      output: ["250,000 tokens", "250K"],
    } as const;
    for (const [id, [full, compact]] of Object.entries(aggregateExpectations)) {
      const context = `composition-${id}`;
      expect(requiredElement(`[data-usage-token-full="${context}"]`).textContent).toBe(full);
      expect(requiredElement(`[data-usage-token-compact="${context}"]`).textContent).toBe(compact);
      expectFullBeforeCompact(context);
    }

    expect(requiredElement('[data-usage-token-full="reasoning"]').textContent).toContain(
      "50,000 reasoning tokens",
    );
    expect(requiredElement('[data-usage-token-compact="reasoning"]').textContent).toBe("50K");
    expectFullBeforeCompact("reasoning");

    const modelFullCounts = Array.from(
      document.querySelectorAll<HTMLElement>('[data-usage-token-full="model"]'),
    );
    const modelCompacts = Array.from(
      document.querySelectorAll<HTMLElement>('[data-usage-token-compact="model"]'),
    );
    expect(modelFullCounts).toHaveLength(3);
    expect(modelCompacts).toHaveLength(3);
    expect(modelCompacts.every((entry) => /[KM]/.test(entry.textContent ?? ""))).toBe(true);
    expect(modelFullCounts.every((entry) => /\d{1,3}(,\d{3})+/.test(entry.textContent ?? ""))).toBe(
      true,
    );
    expect(document.body.textContent).not.toMatch(/\btokens? exact\b/i);
  });

  it("shows a negative net cache saving while writes exceed read discounts", async () => {
    const usage = createUsageDetail();
    mounted = await render(
      <UsageCostContent
        usage={{
          ...usage,
          tokenBreakdown: [
            {
              provider: ProviderDriverKind.make("claudeAgent"),
              model: "claude-opus-5-5",
              inputTokens: 1_000_000,
              cachedInputTokens: 0,
              cacheWriteInputTokens: 1_000_000,
              outputTokens: 0,
              reasoningOutputTokens: 0,
            },
          ],
        }}
      />,
    );
    expect(requiredElement('[data-usage-composition-value="cache-savings"]').textContent).toBe(
      "-$1.00 USD",
    );
    expect(requiredElement('[data-usage-cost-quality-cache-savings="true"]').textContent).toBe(
      "-$1.00 USD",
    );
    await expect
      .element(page.getByText("Cache writes cost more than reads have saved"))
      .toBeVisible();
    await expect.element(page.getByText("Net cache savings (USD)").first()).toBeVisible();
  });

  it("renders the billion-scale shorthand beneath the full counter", async () => {
    const baseline = createUsageDetail();
    const usage = {
      ...baseline,
      totals: {
        ...baseline.totals,
        inputTokens: 3_500_000_000,
        outputTokens: 39_966_200,
      },
    };
    mounted = await render(<UsageCostContent usage={usage} />);

    expect(requiredElement('[data-usage-token-full="composition-processed"]').textContent).toBe(
      "3,539,966,200 tokens",
    );
    expect(requiredElement('[data-usage-token-compact="composition-processed"]').textContent).toBe(
      "3.54B",
    );
    expectFullBeforeCompact("composition-processed");
  });

  it("animates the full aggregate count through a small increment", async () => {
    const initialUsage = createUsageDetail();
    mounted = await render(<UsageCostContent usage={initialUsage} />);
    expect(displayedRawCount("processed")).toBe(3_000_000);

    const nextUsage = {
      ...initialUsage,
      totals: {
        ...initialUsage.totals,
        outputTokens: initialUsage.totals.outputTokens + 10,
      },
    };
    await mounted.rerender(<UsageCostContent usage={nextUsage} />);

    await vi.waitFor(
      () => {
        expect(displayedRawCount("processed")).toBeGreaterThan(3_000_000);
        expect(displayedRawCount("processed")).toBeLessThan(3_000_010);
      },
      { interval: 10, timeout: 1_000 },
    );
    await vi.waitFor(() => expect(displayedRawCount("processed")).toBe(3_000_010), {
      timeout: 3_000,
    });
  });

  it("contains the cost layout within a narrow viewport", async () => {
    const originalViewport = { height: window.innerHeight, width: window.innerWidth };
    await page.viewport(320, 720);
    try {
      mounted = await render(<UsageCostContent usage={createUsageDetail()} />);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth + 1);
      expect(requiredElement('[data-usage-token-full="composition-processed"]')).toBeVisible();
    } finally {
      await page.viewport(originalViewport.width, originalViewport.height);
    }
  });

  it("uses the wide space remaining beside the sidebar for the chart and complete metrics", async () => {
    await page.viewport(1_800, 1_000);
    applyInterfaceScalePercent(100);
    settleLayoutCountersImmediately();
    const usage = createBillionScaleUsageDetail();
    usageHarness.reset(usage, usage);
    mounted = await render(
      <div className="flex h-dvh min-w-0 w-full">
        <aside data-usage-test-sidebar style={{ width: 280, flexShrink: 0 }}>
          Settings navigation
        </aside>
        <UsageStatsPanel />
      </div>,
    );
    await vi.waitFor(() => expect(displayedRawCount("processed")).toBe(3_000_000_000));

    const sidebar = requiredElement("[data-usage-test-sidebar]").getBoundingClientRect();
    const layout = requiredElement("[data-usage-cost-layout]");
    const bounds = layout.getBoundingClientRect();
    // Allow the page's ordinary gutters while rejecting the old 768px cap.
    expect(bounds.width).toBeGreaterThan(window.innerWidth - sidebar.width - 128);
    expect(bounds.left).toBeGreaterThan(sidebar.right);
    const chart = requiredElement('[data-usage-cost-overview] svg[role="img"]');
    expect(chart.getBoundingClientRect().width).toBeGreaterThan(800);
    expect(chart.getBoundingClientRect().height).toBeGreaterThan(260);
    const tiles = Array.from(document.querySelectorAll("[data-usage-composition-tile]"));
    expect(tiles).toHaveLength(5);
    for (const tile of tiles) {
      expect(
        Math.abs(tile.getBoundingClientRect().top - tiles[0]!.getBoundingClientRect().top),
      ).toBeLessThanOrEqual(1);
    }
    expectCompositionNumbersOnOneLine();
    expectNoHorizontalOverflow(layout);
    expectNoHorizontalOverflow(document.documentElement);
  });

  it("stacks in a narrow parent inside a wide viewport and grows the chart with its parent", async () => {
    await page.viewport(1_800, 1_000);
    applyInterfaceScalePercent(100);
    settleLayoutCountersImmediately();
    const usage = createBillionScaleUsageDetail();
    const content = (width: number) => (
      <div data-usage-test-parent style={{ width, maxWidth: "100%" }}>
        <UsageCostContent usage={usage} />
      </div>
    );
    mounted = await render(content(640));
    expectOverviewStacked();
    const narrowChart = requiredElement(
      '[data-usage-cost-overview] svg[role="img"]',
    ).getBoundingClientRect();
    expect(narrowChart.width).toBeGreaterThan(540);
    expectNoHorizontalOverflow(requiredElement("[data-usage-test-parent]"));

    await mounted.rerender(content(1_320));
    const wideChart = requiredElement(
      '[data-usage-cost-overview] svg[role="img"]',
    ).getBoundingClientRect();
    expect(wideChart.width).toBeGreaterThan(narrowChart.width + 200);
    expect(wideChart.height).toBeGreaterThan(narrowChart.height + 80);
    expectCompositionNumbersOnOneLine();
    expectNoHorizontalOverflow(requiredElement("[data-usage-test-parent]"));
  });

  it.each([80, 130])(
    "contains billion-scale usage at %i%% interface scale in wide and 320px panels",
    async (scale) => {
      await page.viewport(1_800, 1_000);
      applyInterfaceScalePercent(scale);
      settleLayoutCountersImmediately();
      const usage = createBillionScaleUsageDetail();
      usageHarness.reset(usage, usage);
      mounted = await render(
        <div className="flex h-dvh min-w-0 w-full">
          <aside style={{ width: 280, flexShrink: 0 }}>Settings navigation</aside>
          <UsageStatsPanel />
        </div>,
      );
      await vi.waitFor(() => expect(displayedRawCount("processed")).toBe(3_000_000_000));
      expectCompositionNumbersOnOneLine();
      expectNoHorizontalOverflow(requiredElement("[data-usage-cost-layout]"));
      expectNoHorizontalOverflow(document.documentElement);

      await page.viewport(320, 1_000);
      await mounted.rerender(
        <div className="flex h-dvh min-w-0 w-full">
          <UsageStatsPanel />
        </div>,
      );
      await vi.waitFor(() => expect(displayedRawCount("processed")).toBe(3_000_000_000));
      expectOverviewStacked();
      const layout = requiredElement("[data-usage-cost-layout]");
      expectNoHorizontalOverflow(layout);
      expectNoHorizontalOverflow(document.documentElement);
      for (const tile of document.querySelectorAll<HTMLElement>("[data-usage-composition-tile]")) {
        expectNoHorizontalOverflow(tile);
      }
    },
  );
});
