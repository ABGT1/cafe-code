import { describe, expect, it } from "vitest";
import { DESK_LIMITS, type DeskLayout } from "../../deskModel";
import {
  DESK_PANE_MIN_SIZE,
  deskDropEdge,
  deskInsertionIndex,
  deskLayoutMinimumSize,
  deskResizeBounds,
  fitDeskLayout,
  projectDeskLayout,
  type DeskSize,
} from "./deskLayout";

const leaf = (groupId: string): DeskLayout => ({ kind: "leaf", groupId });
const split = (
  id: string,
  axis: "x" | "y",
  ratio: number,
  first: DeskLayout = leaf(`${id}-first`),
  second: DeskLayout = leaf(`${id}-second`),
): Extract<DeskLayout, { kind: "split" }> => ({
  kind: "split",
  id,
  axis,
  ratio,
  children: [first, second],
});

function freezeLayout(layout: DeskLayout): DeskLayout {
  if (layout.kind === "split") {
    layout.children.forEach(freezeLayout);
    Object.freeze(layout.children);
  }
  return Object.freeze(layout);
}

function expectMinimumPanes(layout: DeskLayout, size: DeskSize) {
  const projected = projectDeskLayout(layout);
  for (const { rect } of projected.panes) {
    // Projection multiplies ancestor ratios again. Permit only binary
    // arithmetic roundoff, not a visible shortfall in either pane dimension.
    expect(rect.width * size.width).toBeGreaterThanOrEqual(DESK_PANE_MIN_SIZE.width - 1e-9);
    expect(rect.height * size.height).toBeGreaterThanOrEqual(DESK_PANE_MIN_SIZE.height - 1e-9);
  }
  for (const { node } of projected.dividers) {
    expect(node.ratio).toBeGreaterThanOrEqual(DESK_LIMITS.minRatio);
    expect(node.ratio).toBeLessThanOrEqual(DESK_LIMITS.maxRatio);
  }
}

describe("desk pane geometry", () => {
  it("reorders using both halves of the target without losing adjacent moves", () => {
    expect(deskInsertionIndex(0, 1, true)).toBe(1);
    expect(deskInsertionIndex(0, 1, false)).toBe(0);
    expect(deskInsertionIndex(0, 3, true)).toBe(3);
    expect(deskInsertionIndex(3, 0, false)).toBe(0);
    expect(deskInsertionIndex(-1, 2, true)).toBe(3);
  });
  it("projects nested groups into nonoverlapping flat rectangles", () => {
    const result = projectDeskLayout({
      kind: "split",
      id: "s1",
      axis: "x",
      ratio: 0.4,
      children: [
        { kind: "leaf", groupId: "g1" },
        {
          kind: "split",
          id: "s2",
          axis: "y",
          ratio: 0.5,
          children: [
            { kind: "leaf", groupId: "g2" },
            { kind: "leaf", groupId: "g3" },
          ],
        },
      ],
    });
    expect(result.panes).toEqual([
      { groupId: "g1", rect: { x: 0, y: 0, width: 0.4, height: 1 } },
      { groupId: "g2", rect: { x: 0.4, y: 0, width: 0.6, height: 0.5 } },
      { groupId: "g3", rect: { x: 0.4, y: 0.5, width: 0.6, height: 0.5 } },
    ]);
    expect(result.dividers).toHaveLength(2);
    expect(result.panes.reduce((sum, pane) => sum + pane.rect.width * pane.rect.height, 0)).toBe(1);
  });
  it("distinguishes split edges from center moves and rejects invalid coordinates", () => {
    const rect = { left: 100, top: 100, width: 1000, height: 800 };
    expect(deskDropEdge({ x: 110, y: 500 }, rect)).toBe("left");
    expect(deskDropEdge({ x: 1090, y: 500 }, rect)).toBe("right");
    expect(deskDropEdge({ x: 600, y: 110 }, rect)).toBe("top");
    expect(deskDropEdge({ x: 600, y: 890 }, rect)).toBe("bottom");
    expect(deskDropEdge({ x: 600, y: 500 }, rect)).toBeNull();
    expect(deskDropEdge({ x: NaN, y: 500 }, rect)).toBeNull();
    expect(deskDropEdge({ x: 0, y: 0 }, rect)).toBeNull();
  });
});

describe("desk minimum-size fitting", () => {
  it("calculates leaf and nested mixed-axis minima independently of saved ratios", () => {
    expect(DESK_PANE_MIN_SIZE).toEqual({ width: 380, height: 280 });
    expect(deskLayoutMinimumSize(leaf("one"))).toEqual({ width: 380, height: 280 });
    expect(deskLayoutMinimumSize(split("horizontal", "x", 0.2))).toEqual({
      width: 760,
      height: 280,
    });
    expect(deskLayoutMinimumSize(split("vertical", "y", 0.8))).toEqual({ width: 380, height: 560 });
    const mixed = split("outer", "x", 0.2, leaf("one"), split("inner", "y", 0.8));
    expect(deskLayoutMinimumSize(mixed)).toEqual({ width: 760, height: 560 });
    expect(deskLayoutMinimumSize({ ...mixed, ratio: 0.8 })).toEqual(deskLayoutMinimumSize(mixed));
    const sameAxis = split("outer", "x", 0.5, split("inner", "x", 0.5), leaf("three"));
    expect(deskLayoutMinimumSize(sameAxis)).toEqual({ width: 1140, height: 280 });
  });

  it.each(["x", "y"] as const)(
    "includes saved-ratio bounds in asymmetric %s subtree minima",
    (axis) => {
      // Production hydration currently caps the tree at four panes. A larger
      // synthetic tree proves this pure geometry function includes the 20–80%
      // invariant instead of merely summing leaf minima by coincidence.
      const five = split(
        "five",
        axis,
        0.5,
        split("four", axis, 0.5, split("two-a", axis, 0.5), split("two-b", axis, 0.5)),
        leaf("fifth"),
      );
      for (const largeFirst of [true, false]) {
        const tree = split(
          "six",
          axis,
          0.5,
          largeFirst ? five : leaf("sixth"),
          largeFirst ? leaf("sixth") : five,
        );
        const size = axis === "x" ? { width: 2375, height: 280 } : { width: 380, height: 1750 };
        expect(deskLayoutMinimumSize(tree)).toEqual(size);
        const fitted = fitDeskLayout(tree, size);
        expect(fitted?.kind).toBe("split");
        if (!fitted || fitted.kind !== "split") throw new Error("Expected a fitted split");
        expect(fitted.ratio).toBeCloseTo(largeFirst ? 0.8 : 0.2, 14);
        expectMinimumPanes(fitted, size);
      }
    },
  );

  it("returns local divider bounds including child subtree and cross-axis requirements", () => {
    expect(deskResizeBounds(split("pair", "x", 0.2), { width: 1000, height: 600 })).toEqual({
      min: 0.38,
      max: 0.62,
    });
    expect(deskResizeBounds(split("pair", "y", 0.8), { width: 800, height: 700 })).toEqual({
      min: 0.4,
      max: 0.6,
    });
    const nested = split("outer", "x", 0.2, split("inner", "x", 0.5), leaf("third"));
    expect(deskResizeBounds(nested, { width: 1520, height: 280 })).toEqual({ min: 0.5, max: 0.75 });
    expect(deskResizeBounds(nested, { width: 1520, height: 279.99 })).toBeNull();
    expect(deskResizeBounds(nested, { width: 1139.99, height: 280 })).toBeNull();
    expect(deskResizeBounds(split("wide", "x", 0.5), { width: 10000, height: 280 })).toEqual({
      min: 0.2,
      max: 0.8,
    });
  });

  it.each([0.2, 0.8])(
    "recovers a saved %f split without mutating or persisting its preference",
    (savedRatio) => {
      const saved = freezeLayout(split("saved", "x", savedRatio));
      const snapshot = JSON.stringify(saved);
      const fitted = fitDeskLayout(saved, { width: 1000, height: 600 });
      expect(fitted?.kind).toBe("split");
      if (!fitted || fitted.kind !== "split" || saved.kind !== "split")
        throw new Error("Expected a split");
      expect(fitted.ratio).toBe(savedRatio === 0.2 ? 0.38 : 0.62);
      expect(fitted).not.toBe(saved);
      expect(fitted.children[0]).toBe(saved.children[0]);
      expect(fitted.children[1]).toBe(saved.children[1]);
      expect(JSON.stringify(saved)).toBe(snapshot);
      expectMinimumPanes(fitted, { width: 1000, height: 600 });
      // Enlarging the view restores the unchanged user's requested ratio.
      expect(fitDeskLayout(saved, { width: 2000, height: 600 })).toBe(saved);
    },
  );

  it("preserves unchanged references and copies only a changed nested branch", () => {
    const inner = split("inner", "y", 0.2);
    const tree = freezeLayout(split("outer", "x", 0.5, leaf("one"), inner));
    const fitted = fitDeskLayout(tree, { width: 1000, height: 700 });
    if (!fitted || fitted.kind !== "split" || tree.kind !== "split")
      throw new Error("Expected a split");
    expect(fitted).not.toBe(tree);
    expect(fitted.ratio).toBe(0.5);
    expect(fitted.children[0]).toBe(tree.children[0]);
    expect(fitted.children[1]).toEqual({ ...inner, ratio: 0.4 });
    expect(fitted.children[1]).not.toBe(inner);
    expectMinimumPanes(fitted, { width: 1000, height: 700 });
    expect(fitDeskLayout(fitted, { width: 1000, height: 700 })).toBe(fitted);
  });

  it("admits exact 380/280 leaf boundaries and exact nested fits without rounding loops", () => {
    const single = leaf("one");
    expect(fitDeskLayout(single, { width: 380, height: 280 })).toBe(single);
    const pair = split("pair", "x", 0.2);
    expect(deskResizeBounds(pair, { width: 760, height: 280 })).toEqual({ min: 0.5, max: 0.5 });
    expect(fitDeskLayout(pair, { width: 760, height: 280 })).toEqual({ ...pair, ratio: 0.5 });
    const mixed = split("outer", "x", 0.8, leaf("one"), split("inner", "y", 0.2));
    const mixedSize = deskLayoutMinimumSize(mixed);
    const fittedMixed = fitDeskLayout(mixed, mixedSize);
    expect(fittedMixed).not.toBeNull();
    expectMinimumPanes(fittedMixed!, mixedSize);
    // One-third/two-thirds ratios cannot both be represented exactly. Fitting
    // the same-axis tree at its exact minimum must remain stable on repeat.
    const thirds = split("outer", "x", 0.2, split("inner", "x", 0.8), leaf("third"));
    const size = deskLayoutMinimumSize(thirds);
    const fitted = fitDeskLayout(thirds, size);
    expect(fitted).not.toBeNull();
    expectMinimumPanes(fitted!, size);
    expect(fitDeskLayout(fitted!, size)).toBe(fitted);
  });

  it.each([
    { width: 379.99, height: 280 },
    { width: 380, height: 279.99 },
    { width: 0, height: 280 },
    { width: 380, height: 0 },
    { width: -1, height: 280 },
    { width: 380, height: -1 },
    { width: NaN, height: 280 },
    { width: 380, height: NaN },
    { width: Infinity, height: 280 },
    { width: 380, height: Infinity },
    { width: -Infinity, height: 280 },
    { width: Number.MIN_VALUE, height: 280 },
  ])("rejects insufficient or invalid viewport %j", (size) => {
    expect(fitDeskLayout(leaf("one"), size)).toBeNull();
    expect(fitDeskLayout(split("pair", "x", 0.5), size)).toBeNull();
    expect(deskResizeBounds(split("pair", "x", 0.5), size)).toBeNull();
  });

  it("rejects invalid nested ratios instead of emitting nonfinite geometry", () => {
    for (const ratio of [NaN, Infinity, -Infinity]) {
      const tree = split("outer", "x", 0.5, leaf("one"), split("inner", "y", ratio));
      expect(fitDeskLayout(tree, { width: 1000, height: 800 })).toBeNull();
    }
    // Finite out-of-range preferences can still be safely clamped by the pure
    // fitter; reducer/hydration validation remains the persistence authority.
    for (const ratio of [-10, 10]) {
      const tree = split("outer", "x", ratio);
      expect(fitDeskLayout(tree, { width: 2000, height: 800 })).toEqual({
        ...tree,
        ratio: ratio < 0 ? 0.2 : 0.8,
      });
    }
  });
});
