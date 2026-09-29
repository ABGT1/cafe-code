import type { EnvironmentId } from "@cafecode/contracts";
import { create } from "zustand";

import {
  createDeskState,
  DESK_LIMITS,
  hydrateDesk,
  reduceDesk,
  serializeDesk,
  type DeskAction,
  type DeskState,
} from "./deskModel";
import type { StateStorage } from "./lib/storage";

export const DESK_STORAGE_PREFIX = "cafe-code:desk:v1:";
export const DESK_RESIZE_PERSIST_INTERVAL_MS = 200;

export interface DeskStoreState {
  readonly desk: DeskState;
  readonly bindEnvironment: (environmentId: EnvironmentId | null) => void;
  readonly dispatch: (action: DeskAction) => void;
  readonly flushPersistence: () => void;
}

export function deskStorageKey(environmentId: EnvironmentId): string {
  return `${DESK_STORAGE_PREFIX}${encodeURIComponent(environmentId)}`;
}

function browserStorage(): StateStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** A separate factory makes storage denial and environment switching testable
 * without providers, authenticated APIs, or the singleton application store. */
export function createDeskStore(resolveStorage: () => StateStorage | null = browserStorage) {
  let pendingResize: DeskState | null = null;
  let resizeTimer: ReturnType<typeof setTimeout> | null = null;
  let listeningWindow: Window | null = null;

  const persist = (desk: DeskState) => {
    if (desk.environmentId === null) return;
    try {
      const raw = serializeDesk(desk);
      if (
        raw.length <= DESK_LIMITS.persistedBytes &&
        new TextEncoder().encode(raw).byteLength <= DESK_LIMITS.persistedBytes
      )
        resolveStorage()?.setItem(deskStorageKey(desk.environmentId), raw);
    } catch {
      // Full/disabled storage cannot roll back an already-visible tab action.
      // The existing chats, drafts and queued input are stored independently.
    }
  };

  const discardPendingResize = () => {
    if (resizeTimer !== null) clearTimeout(resizeTimer);
    resizeTimer = null;
    pendingResize = null;
    listeningWindow?.removeEventListener("pagehide", flushPersistence);
    listeningWindow = null;
  };
  const flushPersistence = () => {
    const latest = pendingResize;
    discardPendingResize();
    if (latest !== null) persist(latest);
  };
  const scheduleResizePersistence = (desk: DeskState) => {
    pendingResize = desk;
    if (resizeTimer !== null) return;
    // Pointer movement may update the layout at display refresh frequency.
    // Coalesce only those metadata writes, with a fixed maximum delay rather
    // than postponing forever while the user continues dragging the divider.
    resizeTimer = setTimeout(flushPersistence, DESK_RESIZE_PERSIST_INTERVAL_MS);
    if (typeof window !== "undefined") {
      listeningWindow = window;
      listeningWindow.addEventListener("pagehide", flushPersistence);
    }
  };

  return create<DeskStoreState>((set, get) => ({
    desk: createDeskState(),
    flushPersistence,
    bindEnvironment: (environmentId) => {
      if (get().desk.environmentId === environmentId) return;
      // Flush the exact old namespace before selecting another authenticated
      // environment, so a delayed callback cannot publish into its successor.
      flushPersistence();
      if (environmentId === null) {
        set({ desk: createDeskState() });
        return;
      }
      let raw: string | null = null;
      try {
        const saved = resolveStorage()?.getItem(deskStorageKey(environmentId));
        // Browser navigation preferences use synchronous local storage only.
        // A custom async adapter is not allowed to hydrate an old environment
        // after a newer authenticated binding has already been selected.
        if (typeof saved === "string") raw = saved;
      } catch {
        // Storage denial affects persistence, never whether chats can open.
      }
      set({ desk: hydrateDesk(raw, environmentId) });
    },
    dispatch: (action) => {
      const current = get().desk;
      const next = reduceDesk(current, action);
      if (next === current) {
        if (action.type !== "resize") flushPersistence();
        return;
      }
      set({ desk: next });
      if (action.type === "resize") scheduleResizePersistence(next);
      else {
        // A tab operation includes the latest resize and must be immediately
        // durable. Cancel the stale pending snapshot instead of writing both.
        discardPendingResize();
        persist(next);
      }
    },
  }));
}

export const useDeskStore = createDeskStore();
