import { describe, expect, it } from "vitest";
import { deskDropEdge, deskInsertionIndex, projectDeskLayout } from "./deskLayout";

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
