import { describe, expect, it, vi } from "vitest";
import { createChatPaneRuntimeRegistry, createChatPaneSharedValue } from "./chatPaneContext";

describe("chat pane runtime ownership", () => {
  it("assigns a mounted thread to its own pane, not the globally active sibling", () => {
    const runtime = createChatPaneRuntimeRegistry();
    const left = Symbol("left");
    const right = Symbol("right");
    runtime.register(left, { environment: "local", thread: "left-thread", active: true });
    runtime.register(right, { environment: "local", thread: "right-thread", active: false });
    expect(runtime.owns(left, "local", "right-thread")).toBe(false);
    expect(runtime.owns(right, "local", "right-thread")).toBe(true);
    expect(runtime.owns(left, "local", "closed-thread")).toBe(true);
    expect(runtime.owns(right, "local", "closed-thread")).toBe(false);
  });

  it("hands closed-chat queues to one remaining pane without crossing environments", () => {
    const runtime = createChatPaneRuntimeRegistry();
    const first = Symbol("first");
    const fallback = Symbol("fallback");
    const foreign = Symbol("foreign");
    const remove = runtime.register(first, { environment: "local", thread: "chat", active: true });
    runtime.register(fallback, { environment: "local", thread: "other", active: false });
    runtime.register(foreign, { environment: "remote", thread: "chat", active: true });
    remove();
    expect(runtime.owns(fallback, "local", "chat")).toBe(true);
    expect(runtime.owns(foreign, "local", "chat")).toBe(false);
    expect(runtime.owns(fallback, "remote", "chat")).toBe(false);
  });

  it("arbitrates accidental duplicate views and preserves IO and Stop gates during handoff", () => {
    const runtime = createChatPaneRuntimeRegistry();
    const first = Symbol("first");
    const second = Symbol("second");
    const remove = runtime.register(first, { environment: "local", thread: "chat", active: true });
    runtime.register(second, { environment: "local", thread: "chat", active: false });
    const gates = runtime.resource("local:gates", () => ({
      sending: true,
      stopped: new Set(["chat"]),
    }));
    expect(runtime.owns(second, "local", "chat")).toBe(false);
    remove();
    expect(runtime.owns(second, "local", "chat")).toBe(true);
    expect(runtime.resource("local:gates", () => null)).toBe(gates);
    expect(gates.sending).toBe(true);
    expect(gates.stopped.has("chat")).toBe(true);
  });

  it("releases shared attachment resources only with the layout, not a tab", () => {
    const runtime = createChatPaneRuntimeRegistry();
    const dispose = vi.fn();
    const factory = vi.fn(() => ({ draft: "retained" }));
    const value = runtime.resource("queues", factory, dispose);
    expect(runtime.resource("queues", factory, dispose)).toBe(value);
    const remove = runtime.register(Symbol("view"), {
      environment: "a",
      thread: "a",
      active: true,
    });
    remove();
    expect(dispose).not.toHaveBeenCalled();
    runtime.dispose();
    expect(factory).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledExactlyOnceWith(value);
  });
});

describe("shared queue state", () => {
  it("makes edits synchronously visible before React can paint sibling panes", () => {
    const value = createChatPaneSharedValue<Record<string, string[]>>({ a: ["first"] });
    const listener = vi.fn();
    value.subscribe(listener);
    value.set((current) => ({ ...current, b: ["second"] }));
    value.set((current) => ({ ...current, a: [...current.a!, "third"] }));
    expect(value.ref.current).toEqual({ a: ["first", "third"], b: ["second"] });
    expect(value.snapshot()).toBe(value.ref.current);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("notifies after existing imperative refs change, and suppresses no-op snapshots", () => {
    const value = createChatPaneSharedValue({ stopped: false });
    const listener = vi.fn();
    const stop = value.subscribe(listener);
    const next = { stopped: true };
    value.ref.current = next;
    value.set(next);
    value.set(next);
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    value.set({ stopped: false });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
