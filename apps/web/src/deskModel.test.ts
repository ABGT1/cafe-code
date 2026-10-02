import { EnvironmentId, ThreadId } from "@cafecode/contracts";
import { describe, expect, it } from "vitest";

import type { DraftId } from "./composerDraftStore";
import {
  createDeskState,
  DESK_LIMITS,
  deskGroupForTab,
  deskGroupIds,
  deskTabKey,
  hydrateDesk,
  reduceDesk,
  serializeDesk,
  type DeskAction,
  type DeskLayout,
  type DeskState,
} from "./deskModel";
import type { ThreadRouteTarget } from "./threadRoutes";

const environmentId = EnvironmentId.make("desk-local");
const anotherEnvironment = EnvironmentId.make("other-environment");
const server = (id: string, environment = environmentId): ThreadRouteTarget => ({
  kind: "server",
  threadRef: { environmentId: environment, threadId: ThreadId.make(id) },
});
const draft = (id: string): ThreadRouteTarget => ({ kind: "draft", draftId: id as DraftId });
const key = (id: string) => deskTabKey(server(id));

function populated(count = 5): DeskState {
  let state = createDeskState(environmentId);
  for (let i = 0; i < count; i += 1)
    state = reduceDesk(state, { type: "open", target: server(`t${i}`) });
  return state;
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function assertInvariants(state: DeskState): void {
  const ids = deskGroupIds(state.layout);
  expect(ids.length).toBeGreaterThanOrEqual(1);
  expect(ids.length).toBeLessThanOrEqual(DESK_LIMITS.panes);
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids.toSorted()).toEqual(Object.keys(state.groups).toSorted());
  expect(ids).toContain(state.activeGroupId);
  if (state.focusedGroupId !== null) expect(ids).toContain(state.focusedGroupId);
  const open: string[] = [];
  for (const group of Object.values(state.groups)) {
    if (ids.length > 1) expect(group.tabs.length).toBeGreaterThan(0);
    if (group.tabs.length === 0) expect(group.activeTabKey).toBeNull();
    else expect(group.tabs).toContain(group.activeTabKey);
    open.push(...group.tabs);
  }
  expect(open.length).toBeLessThanOrEqual(DESK_LIMITS.tabs);
  expect(new Set(open).size).toBe(open.length);
  expect(state.closed.length).toBeLessThanOrEqual(DESK_LIMITS.closed);
  expect(new Set(state.closed.map((entry) => entry.tabKey)).size).toBe(state.closed.length);
  const retained = new Set([...open, ...state.closed.map((entry) => entry.tabKey)]);
  expect([...retained].toSorted()).toEqual(Object.keys(state.targets).toSorted());
  for (const entry of state.closed) expect(open).not.toContain(entry.tabKey);
  for (const [tabKey, target] of Object.entries(state.targets)) {
    expect(deskTabKey(target)).toBe(tabKey);
    if (target.kind === "server") expect(target.threadRef.environmentId).toBe(state.environmentId);
  }
  const splitIds = new Set<string>();
  const visit = (node: DeskLayout) => {
    if (node.kind === "leaf") return;
    expect(splitIds.has(node.id)).toBe(false);
    splitIds.add(node.id);
    expect(Number.isFinite(node.ratio)).toBe(true);
    expect(node.ratio).toBeGreaterThanOrEqual(DESK_LIMITS.minRatio);
    expect(node.ratio).toBeLessThanOrEqual(DESK_LIMITS.maxRatio);
    node.children.forEach(visit);
  };
  visit(state.layout);
  // Every state we generate must survive the same untrusted-storage decoder.
  if (state.environmentId !== null)
    expect(hydrateDesk(serializeDesk(state), state.environmentId)).toEqual(state);
}

function step(state: DeskState, action: DeskAction): DeskState {
  const next = reduceDesk(freeze(state), action);
  assertInvariants(next);
  return next;
}

describe("Desk navigation model", () => {
  it("starts empty with the familiar project catalog and inherited rail preference", () => {
    const state = createDeskState(environmentId);
    assertInvariants(state);
    expect(state.sidebarMode).toBe("projects");
    expect(state.groups.g1).toMatchObject({
      name: "Main",
      tabs: [],
      activeTabKey: null,
      sessionRailDocked: null,
    });
  });

  it("uses distinct opaque keys for draft/server ids and delimiter-containing scoped identities", () => {
    expect(deskTabKey(draft("t1"))).not.toBe(key("t1"));
    expect(deskTabKey(server("c", EnvironmentId.make("a:b")))).not.toBe(
      deskTabKey(server("b:c", EnvironmentId.make("a"))),
    );
  });

  it("refuses unbound and other-environment opens without changing view state", () => {
    const unbound = createDeskState();
    expect(reduceDesk(unbound, { type: "open", target: server("t") })).toBe(unbound);
    const state = populated();
    expect(reduceDesk(state, { type: "open", target: server("t", anotherEnvironment) })).toBe(
      state,
    );
  });

  it("selects an already-open tab in its existing group instead of cloning it", () => {
    let state = step(populated(), {
      type: "split",
      tabKey: key("t0"),
      targetGroupId: "g1",
      edge: "right",
    });
    const existingGroup = state.activeGroupId;
    state = step(state, { type: "open", target: server("t0"), groupId: "g1" });
    expect(state.activeGroupId).toBe(existingGroup);
    expect(state.groups.g1!.tabs).not.toContain(key("t0"));
    expect(step(state, { type: "select", tabKey: key("t0") })).toBe(state);
  });

  it("moves tabs using final indexes and collapses emptied source groups", () => {
    let state = step(populated(), { type: "move", tabKey: key("t0"), groupId: "g1", index: 4 });
    expect(state.groups.g1!.tabs).toEqual(["t1", "t2", "t3", "t4", "t0"].map(key));
    state = step(state, { type: "split", tabKey: key("t0"), targetGroupId: "g1", edge: "right" });
    const retired = state.activeGroupId;
    state = step(state, { type: "focus", groupId: retired });
    state = step(state, { type: "move", tabKey: key("t0"), groupId: "g1", index: 0 });
    expect(state.layout).toEqual({ kind: "leaf", groupId: "g1" });
    expect(state.activeGroupId).toBe("g1");
    expect(state.focusedGroupId).toBe("g1");
  });

  it.each(["left", "right", "top", "bottom"] as const)(
    "splits only its target at the %s edge",
    (edge) => {
      const before = populated();
      const state = step(before, { type: "split", tabKey: key("t0"), targetGroupId: "g1", edge });
      expect(state.targets).toBe(before.targets);
      expect(state.layout.kind).toBe("split");
      if (state.layout.kind !== "split") throw new Error("Expected a split");
      expect(state.layout.axis).toBe(edge === "left" || edge === "right" ? "x" : "y");
      expect(deskGroupIds(state.layout)).toEqual(
        edge === "left" || edge === "top"
          ? [state.activeGroupId, "g1"]
          : ["g1", state.activeGroupId],
      );
    },
  );

  it("keeps at most four panes but can relocate a sole-tab pane at the cap", () => {
    let state = populated(6);
    for (const id of ["t0", "t1", "t2"])
      state = step(state, { type: "split", tabKey: key(id), targetGroupId: "g1", edge: "right" });
    expect(deskGroupIds(state.layout)).toHaveLength(4);
    expect(
      step(state, { type: "split", tabKey: key("t3"), targetGroupId: "g1", edge: "bottom" }),
    ).toBe(state);
    state = step(state, { type: "split", tabKey: key("t0"), targetGroupId: "g1", edge: "bottom" });
    expect(deskGroupIds(state.layout)).toHaveLength(4);
    expect(
      step(state, {
        type: "split",
        tabKey: key("t0"),
        targetGroupId: state.activeGroupId,
        edge: "right",
      }),
    ).toBe(state);
  });

  it("close-right/others affect only that group, and reopen restores adjacent order", () => {
    let state = step(populated(), {
      type: "split",
      tabKey: key("t4"),
      targetGroupId: "g1",
      edge: "right",
    });
    const other = state.activeGroupId;
    state = step(state, { type: "closeRight", tabKey: key("t1") });
    expect(state.groups.g1!.tabs).toEqual([key("t0"), key("t1")]);
    expect(state.groups[other]!.tabs).toEqual([key("t4")]);
    state = step(step(state, { type: "reopen" }), { type: "reopen" });
    expect(state.groups.g1!.tabs).toEqual(["t0", "t1", "t2", "t3"].map(key));
    state = step(state, { type: "closeOthers", tabKey: key("t2") });
    expect(state.groups.g1!.tabs).toEqual([key("t2")]);
    expect(state.groups[other]!.tabs).toEqual([key("t4")]);
  });

  it("close-all retains one empty group and bounded non-destructive reopen history", () => {
    let state = populated(30);
    state = step(state, { type: "split", tabKey: key("t0"), targetGroupId: "g1", edge: "right" });
    state = step(state, { type: "closeAll" });
    expect(deskGroupIds(state.layout)).toHaveLength(1);
    expect(state.groups[state.activeGroupId]!.tabs).toEqual([]);
    expect(state.closed).toHaveLength(20);
    expect(Object.keys(state.targets)).toHaveLength(20);
    const last = state.closed.at(-1)!.tabKey;
    state = step(state, { type: "reopen" });
    expect(state.groups[state.activeGroupId]!.activeTabKey).toBe(last);
  });

  it("swaps groups, merges without changing target selection, and renames safely", () => {
    let state = step(populated(), {
      type: "split",
      tabKey: key("t0"),
      targetGroupId: "g1",
      edge: "right",
    });
    const other = state.activeGroupId;
    state = step(state, { type: "swapGroups", firstGroupId: "g1", secondGroupId: other });
    expect(deskGroupIds(state.layout)).toEqual([other, "g1"]);
    state = step(state, { type: "renameGroup", groupId: other, name: "  Proof\n review  " });
    expect(state.groups[other]!.name).toBe("Proof review");
    state = step(state, { type: "merge", sourceGroupId: other, targetGroupId: "g1" });
    expect(state.groups.g1!.activeTabKey).toBe(key("t4"));
    expect(state.groups.g1!.tabs.at(-1)).toBe(key("t0"));
  });

  it("makes rail pinning independent, inherits only at split, and keeps merge target choice", () => {
    let state = step(populated(), { type: "sessionRail", groupId: "g1", docked: true });
    state = step(state, { type: "split", tabKey: key("t0"), targetGroupId: "g1", edge: "right" });
    const other = state.activeGroupId;
    expect(state.groups[other]!.sessionRailDocked).toBe(true);
    state = step(state, { type: "sessionRail", groupId: other, docked: false });
    expect(state.groups.g1!.sessionRailDocked).toBe(true);
    expect(state.groups[other]!.sessionRailDocked).toBe(false);
    state = step(state, { type: "merge", sourceGroupId: other, targetGroupId: "g1" });
    expect(state.groups.g1!.sessionRailDocked).toBe(true);
  });

  it("clamps finite resize ratios and rejects malformed/stale actions", () => {
    let state = step(populated(), {
      type: "split",
      tabKey: key("t0"),
      targetGroupId: "g1",
      edge: "right",
    });
    const splitId = state.layout.kind === "split" ? state.layout.id : "";
    state = step(state, { type: "resize", splitId, ratio: 10 });
    expect(state.layout.kind === "split" && state.layout.ratio).toBe(0.8);
    const invalid: DeskAction[] = [
      { type: "resize", splitId, ratio: Number.NaN },
      { type: "move", tabKey: key("t1"), groupId: "g1", index: -1 },
      { type: "move", tabKey: key("t1"), groupId: "g1", index: 99 },
      { type: "move", tabKey: key("t1"), groupId: "g1", index: 0.5 },
      { type: "select", tabKey: "unknown" },
      { type: "activateGroup", groupId: "__proto__" },
      { type: "focus", groupId: "toString" },
      { type: "renameGroup", groupId: "g1", name: "\u0000bad" },
      { type: "renameGroup", groupId: "g1", name: "x".repeat(81) },
    ];
    for (const action of invalid) expect(step(state, action)).toBe(state);
  });

  it("promotes a draft without changing its tab location and deduplicates an already-open server tab", () => {
    const target = server("promoted");
    if (target.kind !== "server") throw new Error("Expected server target");
    let state = step(populated(), { type: "open", target: draft("d1") });
    state = step(state, {
      type: "promoteDraft",
      draftId: "d1" as DraftId,
      threadRef: target.threadRef,
    });
    expect(state.groups.g1!.tabs.at(-1)).toBe(deskTabKey(target));
    expect(Object.hasOwn(state.targets, deskTabKey(draft("d1")))).toBe(false);
    state = step(state, { type: "open", target: draft("d2") });
    state = step(state, {
      type: "split",
      tabKey: deskTabKey(draft("d2")),
      targetGroupId: "g1",
      edge: "right",
    });
    state = step(state, {
      type: "promoteDraft",
      draftId: "d2" as DraftId,
      threadRef: target.threadRef,
    });
    expect(deskGroupIds(state.layout)).toEqual(["g1"]);
    expect(state.groups.g1!.activeTabKey).toBe(deskTabKey(target));
  });

  it("reconciles only explicit authoritative identity inventory and removes stale reopen entries", () => {
    let state = step(populated(), { type: "close", tabKey: key("t0") });
    state = step(state, { type: "split", tabKey: key("t1"), targetGroupId: "g1", edge: "right" });
    state = step(state, { type: "reconcile", targets: [server("t2"), server("t3")] });
    expect(deskGroupIds(state.layout)).toEqual(["g1"]);
    expect(state.groups.g1!.tabs).toEqual([key("t2"), key("t3")]);
    expect(state.closed).toEqual([]);
  });

  it("coalesces a pending server alias into its existing draft pane until the first turn starts", () => {
    const target = server("pending-shell");
    if (target.kind !== "server") throw new Error("Expected server target");
    const draftId = "pending-draft" as DraftId;
    const draftKey = deskTabKey(draft(draftId));
    const serverKey = deskTabKey(target);
    let state = step(populated(1), { type: "open", target: draft(draftId) });
    state = step(state, { type: "open", target });
    state = step(state, {
      type: "split",
      tabKey: serverKey,
      targetGroupId: "g1",
      edge: "right",
    });
    state = step(state, { type: "retainDraft", draftId, threadRef: target.threadRef });
    expect(deskGroupIds(state.layout)).toEqual(["g1"]);
    expect(state.groups.g1!.tabs).toEqual([key("t0"), draftKey]);
    expect(state.groups.g1!.activeTabKey).toBe(draftKey);
    expect(Object.hasOwn(state.targets, serverKey)).toBe(false);
    expect(state.closed).toEqual([]);
    expect(step(state, { type: "retainDraft", draftId, threadRef: target.threadRef })).toBe(state);

    state = step(state, { type: "promoteDraft", draftId, threadRef: target.threadRef });
    expect(state.groups.g1!.tabs).toEqual([key("t0"), serverKey]);
    expect(Object.hasOwn(state.targets, draftKey)).toBe(false);
  });

  it("rewrites pending canonical-only tabs and closed aliases without resurrecting duplicates", () => {
    const target = server("pending-shell");
    if (target.kind !== "server") throw new Error("Expected server target");
    const draftId = "pending-draft" as DraftId;
    const draftKey = deskTabKey(draft(draftId));
    const serverKey = deskTabKey(target);
    let state = step(populated(1), { type: "open", target });
    state = step(state, { type: "retainDraft", draftId, threadRef: target.threadRef });
    expect(state.groups.g1!.tabs).toEqual([key("t0"), draftKey]);
    state = step(state, { type: "close", tabKey: draftKey });
    state = step(state, { type: "open", target });
    state = step(state, { type: "close", tabKey: serverKey });
    expect(state.closed).toHaveLength(2);
    state = step(state, { type: "retainDraft", draftId, threadRef: target.threadRef });
    expect(state.closed.map((entry) => entry.tabKey)).toEqual([draftKey]);
    state = step(state, { type: "reopen" });
    expect(state.groups.g1!.tabs).toEqual([key("t0"), draftKey]);
    expect(state.closed).toEqual([]);
  });

  it("does not bind a draft alias to another environment or an invalid draft identity", () => {
    const target = server("pending-shell");
    if (target.kind !== "server") throw new Error("Expected server target");
    const state = step(populated(1), { type: "open", target });
    expect(
      step(state, {
        type: "retainDraft",
        draftId: "pending-draft" as DraftId,
        threadRef: { ...target.threadRef, environmentId: anotherEnvironment },
      }),
    ).toBe(state);
    expect(
      step(state, {
        type: "retainDraft",
        draftId: "" as DraftId,
        threadRef: target.threadRef,
      }),
    ).toBe(state);
  });

  it("bounds open tabs without deleting existing tab metadata or chats", () => {
    const state = populated(DESK_LIMITS.tabs);
    expect(step(state, { type: "open", target: server("over-limit") })).toBe(state);
    expect(Object.keys(state.targets)).toHaveLength(DESK_LIMITS.tabs);
  });

  it("preserves invariants across deterministic mixed user actions", () => {
    let state = populated(16);
    let seed = 12345;
    const next = (max: number) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed % max;
    };
    for (let i = 0; i < 350; i += 1) {
      const ids = deskGroupIds(state.layout);
      const groupId = ids[next(ids.length)]!;
      const tabKey = key(`t${next(16)}`);
      const actions: DeskAction[] = [
        { type: "open", target: server(`t${next(16)}`), groupId },
        { type: "close", tabKey },
        { type: "reopen" },
        {
          type: "split",
          tabKey,
          targetGroupId: groupId,
          edge: ["left", "right", "top", "bottom"][next(4)] as "left",
        },
        { type: "merge", sourceGroupId: ids[0]!, targetGroupId: groupId },
        { type: "move", tabKey, groupId, index: 0 },
        { type: "closeRight", tabKey },
        { type: "focus", groupId: i % 2 ? groupId : null },
      ];
      state = step(state, actions[next(actions.length)]!);
    }
  });
});

describe("Desk persistence admission", () => {
  it("decodes only navigation fields and no injected content or credentials", () => {
    const state = populated(2);
    const raw = JSON.stringify({
      version: 1,
      desk: { ...state, prompt: "private", token: "secret" },
    });
    expect(hydrateDesk(raw, environmentId)).toEqual(state);
    expect(serializeDesk(hydrateDesk(raw, environmentId))).not.toContain("private");
  });

  it.each([
    null,
    "bad json",
    "null",
    "[]",
    '{"version":9}',
    " ".repeat(DESK_LIMITS.persistedBytes + 1),
  ])("rejects malformed or oversized raw state", (raw) => {
    expect(hydrateDesk(raw, environmentId)).toEqual(createDeskState(environmentId));
  });

  it("rejects foreign environment state without borrowing any tab", () => {
    expect(hydrateDesk(serializeDesk(populated()), anotherEnvironment)).toEqual(
      createDeskState(anotherEnvironment),
    );
  });

  it("rejects cyclic-shaped/deep layout, duplicate ownership, invalid numbers and prototype-shaped keys", () => {
    const state = populated(2);
    const malformed: unknown[] = [
      { ...state, nextId: 1 },
      { ...state, activeGroupId: "__proto__" },
      { ...state, focusedGroupId: "missing" },
      { ...state, groups: { g1: { ...state.groups.g1, activeTabKey: "missing" } } },
      { ...state, groups: { g1: { ...state.groups.g1, tabs: [key("t0"), key("t0")] } } },
      { ...state, groups: { g1: { ...state.groups.g1, sessionRailDocked: "yes" } } },
      {
        ...state,
        layout: {
          kind: "split",
          id: "s1",
          axis: "x",
          ratio: 0.5,
          children: [state.layout, state.layout],
        },
      },
      {
        ...state,
        layout: {
          kind: "split",
          id: "s1",
          axis: "x",
          ratio: Infinity,
          children: [state.layout, state.layout],
        },
      },
      { ...state, closed: [{ tabKey: key("t0"), groupId: "g1", index: 0 }] },
      { ...state, targets: { [key("t0")]: server("different") } },
    ];
    for (const desk of malformed)
      expect(hydrateDesk(JSON.stringify({ version: 1, desk }), environmentId)).toEqual(
        createDeskState(environmentId),
      );
    let deep: unknown = state.layout;
    for (let i = 0; i < 100; i += 1)
      deep = {
        kind: "split",
        id: `s${i + 1}`,
        axis: "x",
        ratio: 0.5,
        children: [deep, state.layout],
      };
    expect(
      hydrateDesk(
        JSON.stringify({ version: 1, desk: { ...state, nextId: 102, layout: deep } }),
        environmentId,
      ),
    ).toEqual(createDeskState(environmentId));
  });

  it("migrates an absent per-group rail preference to inherited without changing siblings", () => {
    const state = populated();
    const raw = JSON.stringify({
      version: 1,
      desk: { ...state, groups: { g1: { ...state.groups.g1, sessionRailDocked: undefined } } },
    });
    expect(hydrateDesk(raw, environmentId).groups.g1!.sessionRailDocked).toBeNull();
  });

  it("does not admit inherited group properties as tab destinations", () => {
    const state = populated();
    expect(deskGroupForTab(state, "__proto__")).toBeUndefined();
    expect(reduceDesk(state, { type: "open", target: server("x"), groupId: "toString" })).toBe(
      state,
    );
  });
});
