import type { ClientRect, CollisionDetection, DroppableContainer } from "@dnd-kit/core";
import { describe, expect, it } from "vitest";

import { deskCollisionDetection } from "./deskDrag";

function rect(left: number, top: number, width: number, height: number): ClientRect {
  return { left, top, width, height, right: left + width, bottom: top + height };
}

function target(
  id: string,
  kind: string,
  groupId: string,
  bounds: ClientRect | null,
  disabled = false,
): DroppableContainer {
  return {
    id,
    key: id,
    disabled,
    data: { current: { kind, groupId } },
    // Collision detection must operate on dnd-kit's measurements without a
    // live DOM or a second layout read. Null nodes deliberately enforce that.
    node: { current: null },
    rect: { current: bounds },
  };
}

function collisionArgs(
  containers: DroppableContainer[],
  point: { x: number; y: number } | null,
  collisionRect = rect(120, 0, 120, 30),
): Parameters<CollisionDetection>[0] {
  return {
    active: {
      id: "source",
      data: { current: { kind: "tab", groupId: "g1", tabKey: "source", index: 0 } },
      rect: { current: { initial: collisionRect, translated: collisionRect } },
    },
    collisionRect,
    droppableContainers: containers,
    droppableRects: new Map(
      containers.flatMap((container) =>
        container.rect.current ? [[container.id, container.rect.current] as const] : [],
      ),
    ),
    pointerCoordinates: point,
  };
}

function fixture() {
  return [
    target("pane:g1", "pane", "g1", rect(0, 0, 1000, 800)),
    target("strip:g1", "strip", "g1", rect(100, 0, 700, 30)),
    target("target:one", "tab", "g1", rect(120, 0, 120, 30)),
  ];
}

const collisionIds = (args: Parameters<CollisionDetection>[0]) =>
  deskCollisionDetection(args).map((collision) => collision.id);

describe("Desk drag collision boundaries", () => {
  it("prioritizes a visible tab over its strip and pane", () => {
    expect(collisionIds(collisionArgs(fixture(), { x: 180, y: 15 }))).toEqual([
      "target:one",
      "strip:g1",
      "pane:g1",
    ]);
    expect(collisionIds(collisionArgs(fixture(), { x: 700, y: 15 }))).toEqual([
      "strip:g1",
      "pane:g1",
    ]);
    expect(collisionIds(collisionArgs(fixture(), { x: 20, y: 400 }))).toEqual(["pane:g1"]);
  });

  it("does not target an overlapping dragged rectangle after the pointer leaves a pane", () => {
    expect(
      collisionIds(collisionArgs(fixture(), { x: -1, y: 400 }, rect(-50, 380, 120, 30))),
    ).toEqual([]);
  });

  it("clips a partially scrolled tab to its visible strip", () => {
    const containers = fixture();
    containers[2] = target("target:one", "tab", "g1", rect(60, 0, 120, 30));
    expect(collisionIds(collisionArgs(containers, { x: 80, y: 15 }))).toEqual(["pane:g1"]);
    expect(collisionIds(collisionArgs(containers, { x: 120, y: 15 }))).toEqual([
      "target:one",
      "strip:g1",
      "pane:g1",
    ]);
  });

  it("does not let a hidden overflow tab steal the neighboring pane's left edge", () => {
    const containers = [
      target("pane:g1", "pane", "g1", rect(0, 0, 400, 800)),
      target("strip:g1", "strip", "g1", rect(100, 0, 280, 30)),
      target("target:one", "tab", "g1", rect(350, 0, 160, 30)),
      target("pane:g2", "pane", "g2", rect(400, 0, 400, 800)),
      target("strip:g2", "strip", "g2", rect(460, 0, 300, 30)),
    ];
    expect(collisionIds(collisionArgs(containers, { x: 420, y: 15 }))).toEqual(["pane:g2"]);
    expect(collisionIds(collisionArgs(containers, { x: 480, y: 15 }))).toEqual([
      "strip:g2",
      "pane:g2",
    ]);
  });

  it("clips a strip and its tabs to their exact owning pane", () => {
    const containers = [
      target("pane:g1", "pane", "g1", rect(0, 0, 400, 800)),
      target("strip:g1", "strip", "g1", rect(100, 0, 500, 30)),
      target("target:one", "tab", "g1", rect(350, 0, 160, 30)),
      target("pane:g2", "pane", "g2", rect(400, 0, 400, 800)),
    ];
    expect(collisionIds(collisionArgs(containers, { x: 420, y: 15 }))).toEqual(["pane:g2"]);
  });

  it.each(["missing", "unmeasured", "disabled"] as const)(
    "does not admit tabs through a %s strip",
    (state) => {
      const containers = fixture();
      if (state === "missing") containers.splice(1, 1);
      else if (state === "unmeasured") containers[1]!.rect.current = null;
      else containers[1]!.disabled = true;
      expect(collisionIds(collisionArgs(containers, { x: 180, y: 15 }))).toEqual(["pane:g1"]);
    },
  );

  it.each(["missing", "unmeasured", "disabled"] as const)(
    "does not admit a strip or tab through a %s pane",
    (state) => {
      const containers = fixture();
      if (state === "missing") containers.splice(0, 1);
      else if (state === "unmeasured") containers[0]!.rect.current = null;
      else containers[0]!.disabled = true;
      expect(collisionIds(collisionArgs(containers, { x: 180, y: 15 }))).toEqual([]);
    },
  );

  it("ignores disabled or unknown target metadata", () => {
    const containers = fixture();
    containers[2]!.disabled = true;
    containers.push(target("target:unknown", "group", "g1", rect(120, 0, 120, 30)));
    const absent = target("target:absent", "tab", "g1", rect(120, 0, 120, 30));
    absent.data.current = undefined;
    containers.push(absent);
    containers.push(target("target:empty", "tab", "", rect(120, 0, 120, 30)));
    expect(collisionIds(collisionArgs(containers, { x: 180, y: 15 }))).toEqual([
      "strip:g1",
      "pane:g1",
    ]);
  });

  it("preserves rectangle overlap navigation when the keyboard supplies no pointer", () => {
    const containers = fixture();
    containers.push(target("unknown", "group", "g1", rect(120, 0, 120, 30)));
    containers.push(target("disabled", "tab", "g1", rect(120, 0, 120, 30), true));
    expect(collisionIds(collisionArgs(containers, null))).toEqual([
      "target:one",
      "strip:g1",
      "pane:g1",
    ]);
  });
});
