import {
  pointerWithin,
  rectIntersection,
  type CollisionDetection,
  type DroppableContainer,
  type UniqueIdentifier,
} from "@dnd-kit/core";

type DeskDropTarget = { kind: "tab" | "strip" | "pane"; groupId: string };

function readDeskDropTarget(container: DroppableContainer): DeskDropTarget | null {
  const data = container.data.current;
  if (
    container.disabled ||
    !data ||
    typeof data.groupId !== "string" ||
    data.groupId.length === 0 ||
    (data.kind !== "tab" && data.kind !== "strip" && data.kind !== "pane")
  ) {
    return null;
  }
  return { kind: data.kind, groupId: data.groupId };
}

const targetPriority = { tab: 0, strip: 1, pane: 2 } as const;

/**
 * dnd-kit 6.3's pointerWithin uses each measured element's full rectangle; it
 * does not clip a tab to its overflow-scrolling strip or to the containing
 * pane. Its measured rectangles already track ancestor scroll offsets, so use
 * those same measurements for both the target and its visible boundaries.
 * Reading layout again on every pointer move would add forced DOM work and
 * could disagree with the rectangle dnd-kit subsequently publishes as `over`.
 */
export const deskCollisionDetection: CollisionDetection = (args) => {
  const targets = new Map<UniqueIdentifier, DeskDropTarget>();
  const droppableContainers = args.droppableContainers.filter((container) => {
    const target = readDeskDropTarget(container);
    if (!target) return false;
    targets.set(container.id, target);
    return true;
  });
  const admitted = { ...args, droppableContainers };

  // KeyboardSensor has no pointer. Preserve its existing rectangle-based
  // navigation, but never use a dragged rectangle to invent a pointer target
  // after the pointer leaves the workspace or a gap between visible panes.
  if (!args.pointerCoordinates) return rectIntersection(admitted);

  const hits = pointerWithin(admitted);
  const paneGroups = new Set<string>();
  const stripGroups = new Set<string>();
  for (const hit of hits) {
    const target = targets.get(hit.id);
    if (target?.kind === "pane") paneGroups.add(target.groupId);
    else if (target?.kind === "strip") stripGroups.add(target.groupId);
  }

  return hits
    .filter((hit) => {
      const target = targets.get(hit.id);
      if (!target || !paneGroups.has(target.groupId)) return false;
      // An overflow tab may geometrically reach a neighboring pane, group
      // control, or strip. Only its exact group's visible strip can admit it.
      // Missing/disabled/unmeasured parents therefore cannot grant a target.
      return target.kind !== "tab" || stripGroups.has(target.groupId);
    })
    .toSorted(
      (a, b) => targetPriority[targets.get(a.id)!.kind] - targetPriority[targets.get(b.id)!.kind],
    );
};
