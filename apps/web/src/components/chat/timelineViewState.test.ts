import { describe, expect, it } from "vitest";
import {
  rememberTimelineView,
  resolveInitialTimelinePosition,
  type TimelineViewPosition,
} from "./timelineViewState";

describe("Desk timeline review state", () => {
  it("restores a stable row anchor when earlier rows change", () => {
    const cache = new Map<string, TimelineViewPosition>();
    rememberTimelineView(
      cache,
      "env:thread",
      {
        data: [{ id: "a" }, { id: "b" }],
        start: 1,
        scroll: 215,
        positionAtIndex: () => 200,
      },
      false,
    );
    expect(
      resolveInitialTimelinePosition(cache.get("env:thread")!, [
        { id: "new" },
        { id: "a" },
        { id: "b" },
      ]),
    ).toEqual({
      initialScrollAtEnd: false,
      initialScrollIndex: { index: 2, viewOffset: -15 },
    });
  });
  it("keeps tail following and uses a bounded offset fallback for a missing row", () => {
    const position = { following: false, rowId: "gone", offset: 10, scroll: 250 };
    expect(resolveInitialTimelinePosition(position, [{ id: "a" }])).toEqual({
      initialScrollAtEnd: false,
      initialScrollOffset: 250,
    });
    expect(resolveInitialTimelinePosition({ ...position, following: true }, [])).toEqual({
      initialScrollAtEnd: true,
    });
    expect(resolveInitialTimelinePosition(null, [])).toEqual({ initialScrollAtEnd: true });
  });
  it("bounds the in-memory cache without mixing environment keys or accepting invalid offsets", () => {
    const cache = new Map<string, TimelineViewPosition>();
    const state = { data: [{ id: "a" }], start: 0, scroll: 3, positionAtIndex: () => 0 };
    for (let index = 0; index < 70; index++)
      rememberTimelineView(cache, `env:${index}`, state, false);
    expect(cache.size).toBe(64);
    expect(cache.has("env:0")).toBe(false);
    rememberTimelineView(cache, "foreign:69", { ...state, scroll: Number.NaN }, false);
    expect(cache.has("foreign:69")).toBe(false);
    expect(cache.has("env:69")).toBe(true);
  });
});
