import { DESK_LIMITS, type DeskLayout } from "../../deskModel";

export interface DeskSize {
  readonly width: number;
  readonly height: number;
}

export const DESK_PANE_MIN_SIZE = { width: 380, height: 280 } as const;

type DeskSplit = Extract<DeskLayout, { kind: "split" }>;

/**
 * A few binary rounding units are unavoidable when a nested split divides an
 * exact minimum extent and its child multiplies that ratio back into pixels.
 * This tolerance is relative to the operands, not a visible pixel allowance;
 * it must not make a genuinely undersized workspace count as fitting.
 */
function fitsExtent(available: number, required: number): boolean {
  if (!Number.isFinite(available) || !Number.isFinite(required)) return false;
  return (
    available >= required ||
    required - available <= Number.EPSILON * 32 * Math.max(1, available, required)
  );
}

function validDeskSize(size: DeskSize): boolean {
  return (
    Number.isFinite(size.width) && Number.isFinite(size.height) && size.width > 0 && size.height > 0
  );
}

/**
 * Return the space this topology needs, independent of its saved ratios.
 * Along a split axis the children need their combined minima. The 20–80%
 * persistence invariant also limits how much of the parent either subtree can
 * receive, so an asymmetric subtree can require more than that simple sum.
 * Across the split axis both children share the full parent extent.
 */
export function deskLayoutMinimumSize(layout: DeskLayout): DeskSize {
  if (layout.kind === "leaf") return { ...DESK_PANE_MIN_SIZE };
  const first = deskLayoutMinimumSize(layout.children[0]);
  const second = deskLayoutMinimumSize(layout.children[1]);
  const axis = layout.axis === "x" ? "width" : "height";
  const crossAxis = layout.axis === "x" ? "height" : "width";
  const splitExtent = Math.max(
    first[axis] + second[axis],
    first[axis] / DESK_LIMITS.maxRatio,
    second[axis] / (1 - DESK_LIMITS.minRatio),
  );
  const crossExtent = Math.max(first[crossAxis], second[crossAxis]);
  return layout.axis === "x"
    ? { width: splitExtent, height: crossExtent }
    : { width: crossExtent, height: splitExtent };
}

/**
 * Bounds for one divider inside its own pixel-sized rectangle, not the entire
 * workspace. Enforce both child subtrees' needs and the reducer's saved-ratio
 * limits. Returning null means no divider position can make this topology fit;
 * only that case should trigger the UI's single-pane fallback.
 */
export function deskResizeBounds(
  split: DeskSplit,
  size: DeskSize,
): { min: number; max: number } | null {
  if (!validDeskSize(size)) return null;
  const first = deskLayoutMinimumSize(split.children[0]);
  const second = deskLayoutMinimumSize(split.children[1]);
  const axis = split.axis === "x" ? "width" : "height";
  const crossAxis = split.axis === "x" ? "height" : "width";
  if (!fitsExtent(size[crossAxis], Math.max(first[crossAxis], second[crossAxis]))) return null;
  const min = Math.max(DESK_LIMITS.minRatio, first[axis] / size[axis]);
  const max = Math.min(DESK_LIMITS.maxRatio, 1 - second[axis] / size[axis]);
  if (min > max) {
    if (!fitsExtent(max, min)) return null;
    // Exact-fit boundaries can cross by a rounding unit. Collapse that tiny
    // interval without ever publishing a ratio outside the persisted bounds.
    const ratio = Math.max(DESK_LIMITS.minRatio, Math.min(DESK_LIMITS.maxRatio, (min + max) / 2));
    return { min: ratio, max: ratio };
  }
  return { min, max };
}

/**
 * Fit saved preferences into the current viewport without changing or saving
 * those preferences. In particular, a previously saved 20/80 split should
 * render at a recoverable wider ratio instead of hiding its own divider.
 * Retain every unchanged node reference so callers can cheaply memoize normal
 * layouts. The bounded Desk tree needs one direct clamp per split, not a
 * convergence loop that could oscillate at exact minimum-size boundaries.
 */
export function fitDeskLayout(layout: DeskLayout, size: DeskSize): DeskLayout | null {
  if (!validDeskSize(size)) return null;
  if (layout.kind === "leaf") {
    return fitsExtent(size.width, DESK_PANE_MIN_SIZE.width) &&
      fitsExtent(size.height, DESK_PANE_MIN_SIZE.height)
      ? layout
      : null;
  }
  if (!Number.isFinite(layout.ratio)) return null;
  const bounds = deskResizeBounds(layout, size);
  if (!bounds) return null;
  const ratio = Math.max(bounds.min, Math.min(bounds.max, layout.ratio));
  const axis = layout.axis === "x" ? "width" : "height";
  const first = fitDeskLayout(layout.children[0], { ...size, [axis]: size[axis] * ratio });
  const second = fitDeskLayout(layout.children[1], { ...size, [axis]: size[axis] * (1 - ratio) });
  if (!first || !second) return null;
  return ratio === layout.ratio && first === layout.children[0] && second === layout.children[1]
    ? layout
    : { ...layout, ratio, children: [first, second] };
}

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
