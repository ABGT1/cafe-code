import type { LegendListState } from "@legendapp/list/react";

/** Private, bounded view state only: never persisted chat contents or provider state. */
export interface TimelineViewPosition {
  readonly following: boolean;
  readonly rowId: string | null;
  readonly offset: number;
  readonly scroll: number;
}

export function rememberTimelineView(
  cache: Map<string, TimelineViewPosition>,
  key: string,
  state: Pick<LegendListState, "data" | "start" | "scroll" | "positionAtIndex">,
  following: boolean,
) {
  if (!Number.isFinite(state.scroll) || state.scroll < 0) return;
  const row = state.data[state.start] as { id?: unknown } | undefined;
  const position = state.positionAtIndex(state.start);
  cache.delete(key);
  cache.set(key, {
    following,
    rowId: typeof row?.id === "string" ? row.id : null,
    offset: Number.isFinite(position) ? state.scroll - position : 0,
    scroll: state.scroll,
  });
  // The shelf can hold many tabs, but review positions must not retain unbounded
  // state in long-running sessions. Dropping an old position never drops a chat.
  while (cache.size > 64) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export function resolveInitialTimelinePosition(
  position: TimelineViewPosition | null,
  rows: readonly { id: string }[],
) {
  if (!position || position.following) return { initialScrollAtEnd: true };
  const index = rows.findIndex((row) => row.id === position.rowId);
  return index >= 0
    ? { initialScrollAtEnd: false, initialScrollIndex: { index, viewOffset: -position.offset } }
    : { initialScrollAtEnd: false, initialScrollOffset: position.scroll };
}
