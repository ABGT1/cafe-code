import { EnvironmentId, ThreadId } from "@cafecode/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDeskState, deskTabKey, serializeDesk } from "./deskModel";
import { createDeskStore, DESK_RESIZE_PERSIST_INTERVAL_MS, deskStorageKey } from "./deskStore";
import { createMemoryStorage, type StateStorage } from "./lib/storage";
import type { ThreadRouteTarget } from "./threadRoutes";

const environmentId = EnvironmentId.make("desk-test");
const otherEnvironment = EnvironmentId.make("desk-other");
const denied = () => {
  throw new Error("denied");
};
const target = (environment = environmentId): ThreadRouteTarget => ({
  kind: "server",
  threadRef: { environmentId: environment, threadId: ThreadId.make("same-id") },
});

function resizableStore() {
  const storage = createMemoryStorage();
  const writes = vi.spyOn(storage, "setItem");
  const store = createDeskStore(() => storage);
  store.getState().bindEnvironment(environmentId);
  store.getState().dispatch({ type: "open", target: target() });
  const second: ThreadRouteTarget = {
    kind: "server",
    threadRef: { environmentId, threadId: ThreadId.make("second") },
  };
  store.getState().dispatch({ type: "open", target: second });
  store
    .getState()
    .dispatch({ type: "split", tabKey: deskTabKey(second), targetGroupId: "g1", edge: "right" });
  const layout = store.getState().desk.layout;
  if (layout.kind !== "split") throw new Error("Expected split layout");
  writes.mockClear();
  return { storage, writes, store, splitId: layout.id };
}

describe("Desk store", () => {
  it("binds only after authenticated environment selection and persists layout independently", () => {
    const storage = createMemoryStorage();
    const store = createDeskStore(() => storage);
    store.getState().dispatch({ type: "open", target: target() });
    expect(store.getState().desk.targets).toEqual({});
    store.getState().bindEnvironment(environmentId);
    store.getState().dispatch({ type: "open", target: target() });
    store.getState().dispatch({ type: "sidebarMode", mode: "desk" });
    const second = createDeskStore(() => storage);
    second.getState().bindEnvironment(environmentId);
    expect(second.getState().desk).toEqual(store.getState().desk);
    expect(second.getState().desk.groups.g1!.tabs).toEqual([deskTabKey(target())]);
  });

  it("does not leak same-id threads across environment bindings", () => {
    const storage = createMemoryStorage();
    const store = createDeskStore(() => storage);
    store.getState().bindEnvironment(environmentId);
    store.getState().dispatch({ type: "open", target: target() });
    store.getState().bindEnvironment(otherEnvironment);
    expect(store.getState().desk.targets).toEqual({});
    store.getState().dispatch({ type: "open", target: target(otherEnvironment) });
    expect(store.getState().desk.groups.g1!.tabs).toEqual([deskTabKey(target(otherEnvironment))]);
    store.getState().bindEnvironment(environmentId);
    expect(store.getState().desk.groups.g1!.tabs).toEqual([deskTabKey(target())]);
    store.getState().bindEnvironment(null);
    expect(store.getState().desk).toEqual(createDeskState());
  });

  it("storage denial and quota errors never stop in-memory tab operations", () => {
    const storage: StateStorage = { getItem: denied, setItem: denied, removeItem: denied };
    const store = createDeskStore(() => storage);
    expect(() => store.getState().bindEnvironment(environmentId)).not.toThrow();
    expect(() => store.getState().dispatch({ type: "open", target: target() })).not.toThrow();
    expect(store.getState().desk.groups.g1!.tabs).toEqual([deskTabKey(target())]);
  });

  it("does not rewrite storage for no-op actions or repeat bindings", () => {
    const storage = { ...createMemoryStorage(), setItem: vi.fn() };
    const store = createDeskStore(() => storage);
    store.getState().bindEnvironment(environmentId);
    store.getState().dispatch({ type: "close", tabKey: "missing" });
    const before = store.getState().desk;
    store.getState().bindEnvironment(environmentId);
    expect(store.getState().desk).toBe(before);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("leaves invalid persisted data untouched until a real navigation change", () => {
    const storage = createMemoryStorage();
    storage.setItem(deskStorageKey(environmentId), "invalid");
    const store = createDeskStore(() => storage);
    store.getState().bindEnvironment(environmentId);
    expect(store.getState().desk).toEqual(createDeskState(environmentId));
    expect(storage.getItem(deskStorageKey(environmentId))).toBe("invalid");
    store.getState().dispatch({ type: "sidebarMode", mode: "desk" });
    expect(storage.getItem(deskStorageKey(environmentId))).toBe(
      serializeDesk(store.getState().desk),
    );
  });
});

describe("Desk resize persistence coalescing", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("updates layout immediately but bounds storage writes while continuously dragging", () => {
    const { store, writes, splitId } = resizableStore();
    store.getState().dispatch({ type: "resize", splitId, ratio: 0.3 });
    expect(store.getState().desk.layout).toMatchObject({ ratio: 0.3 });
    vi.advanceTimersByTime(DESK_RESIZE_PERSIST_INTERVAL_MS / 2);
    store.getState().dispatch({ type: "resize", splitId, ratio: 0.6 });
    expect(writes).not.toHaveBeenCalled();
    vi.advanceTimersByTime(DESK_RESIZE_PERSIST_INTERVAL_MS / 2);
    expect(writes).toHaveBeenCalledExactlyOnceWith(
      deskStorageKey(environmentId),
      serializeDesk(store.getState().desk),
    );
    store.getState().dispatch({ type: "resize", splitId, ratio: 0.7 });
    vi.advanceTimersByTime(DESK_RESIZE_PERSIST_INTERVAL_MS);
    expect(writes).toHaveBeenCalledTimes(2);
  });

  it("the next tab action writes the latest layout once and cancels the older snapshot", () => {
    const { store, writes, splitId } = resizableStore();
    store.getState().dispatch({ type: "resize", splitId, ratio: 0.65 });
    store.getState().dispatch({ type: "sidebarMode", mode: "desk" });
    expect(writes).toHaveBeenCalledExactlyOnceWith(
      deskStorageKey(environmentId),
      serializeDesk(store.getState().desk),
    );
    vi.advanceTimersByTime(DESK_RESIZE_PERSIST_INTERVAL_MS);
    expect(writes).toHaveBeenCalledTimes(1);
  });

  it("a no-op tab action flushes pending resize without waiting for another render", () => {
    const { store, writes, splitId } = resizableStore();
    store.getState().dispatch({ type: "resize", splitId, ratio: 0.65 });
    store.getState().dispatch({ type: "close", tabKey: "missing" });
    expect(writes).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(DESK_RESIZE_PERSIST_INTERVAL_MS);
    expect(writes).toHaveBeenCalledTimes(1);
  });

  it("flushes the old authenticated namespace before rebinding or clearing it", () => {
    const { store, writes, splitId } = resizableStore();
    store.getState().dispatch({ type: "resize", splitId, ratio: 0.65 });
    const saved = serializeDesk(store.getState().desk);
    store.getState().bindEnvironment(otherEnvironment);
    expect(writes).toHaveBeenCalledExactlyOnceWith(deskStorageKey(environmentId), saved);
    vi.advanceTimersByTime(DESK_RESIZE_PERSIST_INTERVAL_MS);
    expect(writes).toHaveBeenCalledTimes(1);
    store.getState().bindEnvironment(environmentId);
    expect(serializeDesk(store.getState().desk)).toBe(saved);
    store.getState().dispatch({ type: "resize", splitId, ratio: 0.4 });
    store.getState().bindEnvironment(null);
    expect(writes).toHaveBeenCalledTimes(2);
  });

  it("flushes once on pagehide and removes its temporary listener", () => {
    const fakeWindow = new EventTarget();
    const remove = vi.spyOn(fakeWindow, "removeEventListener");
    vi.stubGlobal("window", fakeWindow);
    const { store, writes, splitId } = resizableStore();
    store.getState().dispatch({ type: "resize", splitId, ratio: 0.65 });
    fakeWindow.dispatchEvent(new Event("pagehide"));
    expect(writes).toHaveBeenCalledExactlyOnceWith(
      deskStorageKey(environmentId),
      serializeDesk(store.getState().desk),
    );
    expect(remove).toHaveBeenCalledWith("pagehide", expect.any(Function));
    fakeWindow.dispatchEvent(new Event("pagehide"));
    vi.advanceTimersByTime(DESK_RESIZE_PERSIST_INTERVAL_MS);
    expect(writes).toHaveBeenCalledTimes(1);
  });

  it("supports explicit release flush without changing state or writing twice", () => {
    const { store, writes, splitId } = resizableStore();
    store.getState().dispatch({ type: "resize", splitId, ratio: 0.65 });
    const before = store.getState().desk;
    store.getState().flushPersistence();
    store.getState().flushPersistence();
    expect(store.getState().desk).toBe(before);
    expect(writes).toHaveBeenCalledTimes(1);
  });
});
