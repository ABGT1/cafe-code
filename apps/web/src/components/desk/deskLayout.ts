import type { DeskLayout } from "../../deskModel";

export interface DeskRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
/** Reducers receive the insertion index after removing the source tab. */
export function deskInsertionIndex(sourceIndex: number, targetIndex: number, after: boolean) {
  const insertion = targetIndex + (after ? 1 : 0);
  return Math.max(0, insertion - (sourceIndex >= 0 && sourceIndex < insertion ? 1 : 0));
}
export interface DeskDivider {
  node: Extract<DeskLayout, { kind: "split" }>;
  rect: DeskRect;
}

/**
 * Keep the pane DOM flat. Moving a selected chat between groups then changes
 * only its rectangle/context, not its React parent, preserving the existing
 * composer, timeline and in-flight UI state instead of recreating ChatView.
 */
export function projectDeskLayout(layout: DeskLayout): {
  panes: Array<{ groupId: string; rect: DeskRect }>;
  dividers: DeskDivider[];
} {
  const panes: Array<{ groupId: string; rect: DeskRect }> = [];
  const dividers: DeskDivider[] = [];
  function visit(node: DeskLayout, rect: DeskRect) {
    if (node.kind === "leaf") {
      panes.push({ groupId: node.groupId, rect });
      return;
    }
    dividers.push({ node, rect });
    if (node.axis === "x") {
      visit(node.children[0], { ...rect, width: rect.width * node.ratio });
      visit(node.children[1], {
        ...rect,
        x: rect.x + rect.width * node.ratio,
        width: rect.width * (1 - node.ratio),
      });
    } else {
      visit(node.children[0], { ...rect, height: rect.height * node.ratio });
      visit(node.children[1], {
        ...rect,
        y: rect.y + rect.height * node.ratio,
        height: rect.height * (1 - node.ratio),
      });
    }
  }
  visit(layout, { x: 0, y: 0, width: 1, height: 1 });
  return { panes, dividers };
}

export function deskDropEdge(
  point: { x: number; y: number },
  rect: { left: number; top: number; width: number; height: number },
): "left" | "right" | "top" | "bottom" | null {
  if (
    ![point.x, point.y, rect.left, rect.top, rect.width, rect.height].every(Number.isFinite) ||
    rect.width <= 0 ||
    rect.height <= 0
  )
    return null;
  const x = (point.x - rect.left) / rect.width;
  const y = (point.y - rect.top) / rect.height;
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;
  const edges = [
    ["left", x],
    ["right", 1 - x],
    ["top", y],
    ["bottom", 1 - y],
  ] as const;
  const nearest = edges.reduce((a, b) => (b[1] < a[1] ? b : a));
  return nearest[1] < 0.2 ? nearest[0] : null;
}
