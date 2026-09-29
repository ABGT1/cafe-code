import "../../index.css";
import type { CDPSession } from "@vitest/browser-playwright";

import { EnvironmentId, ThreadId, type ContextMenuItem } from "@cafecode/contracts";
import { cdp, page, userEvent } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { createDeskState, deskGroupIds, deskTabKey } from "../../deskModel";
import { useDeskStore } from "../../deskStore";
import { applyInterfaceScalePercent } from "../../interfaceScale";
import type { ThreadRouteTarget } from "../../threadRoutes";
import DeskWorkspace from "./DeskWorkspace";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn<(options: { to: string; params?: Record<string, string> }) => Promise<void>>(),
  showMenu: vi.fn<(items: ContextMenuItem[]) => Promise<string | undefined>>(),
  rename: vi.fn(async () => undefined),
  palette: vi.fn(),
  // Synthetic authoritative inventory and reactive route parameters exercise
  // route echo reconciliation without providers, transports or user profiles.
  params: {} as Record<string, string>,
  primaryEnvironmentId: "workspace-fixture",
  routeListeners: new Set<() => void>(),
  environment: {
    bootstrapComplete: true,
    threadShellById: Object.fromEntries(
      ["one", "two", "three"].map((id) => [id, { id, archivedAt: null }]),
    ) as Record<string, { id: string; archivedAt: string | null }>,
  },
  composer: {
    draftThreadsByThreadKey: {} as Record<
      string,
      {
        environmentId: string;
        threadId: string;
        promotedTo?: { environmentId: string; threadId: string };
      }
    >,
  },
}));
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const { useSyncExternalStore } = await import("react");
  return {
    ...(await importOriginal<typeof import("@tanstack/react-router")>()),
    useNavigate: () => mocks.navigate,
    useParams: ({ select }: { select: (params: Record<string, string>) => unknown }) => {
      const params = useSyncExternalStore(
        (listener) => {
          mocks.routeListeners.add(listener);
          return () => {
            mocks.routeListeners.delete(listener);
          };
        },
        () => mocks.params,
      );
      return select(params);
    },
  };
});
vi.mock("../../environments/primary", () => ({
  usePrimaryEnvironmentId: () => mocks.primaryEnvironmentId,
}));
vi.mock("../../store", () => ({
  useStore: (selector: (state: object) => unknown) => selector({}),
  selectEnvironmentState: () => mocks.environment,
  selectThreadByRef: () => undefined,
}));
vi.mock("../../composerDraftStore", () => ({
  DraftId: { make: (value: string) => value },
  finalizePromotedDraftThreadByRef: vi.fn(),
  useComposerDraftStore: (selector: (state: typeof mocks.composer) => unknown) =>
    selector(mocks.composer),
}));
vi.mock("../ChatView.logic", () => ({ threadHasStarted: () => false }));
vi.mock("../../uiStateStore", () => ({
  useUiStateStore: (selector: (state: { sessionRailDocked: boolean }) => unknown) =>
    selector({ sessionRailDocked: true }),
}));
vi.mock("../../commandPaletteStore", () => ({
  useCommandPaletteStore: { getState: () => ({ setOpen: mocks.palette }) },
}));
vi.mock("../../localApi", () => ({
  readLocalApi: () => ({ contextMenu: { show: mocks.showMenu } }),
}));
vi.mock("../../threadRename", () => ({ renameThread: mocks.rename }));
vi.mock("../../lib/utils", () => ({
  cn: (...values: unknown[]) => values.flat().filter(Boolean).join(" "),
  newCommandId: () => "fixture-command",
  isMacPlatform: () => false,
}));
vi.mock("./useDeskTabMetadata", () => {
  const projectName = "Fixture project";
  const metadata = (target: ThreadRouteTarget) => ({
    title: target.kind === "server" ? `Chat ${target.threadRef.threadId}` : "New chat",
    projectName,
    threadRef: target.kind === "server" ? target.threadRef : null,
    working: false,
    attention: false,
    exists: true,
    status: null,
  });
  return { useDeskTabMetadata: metadata, readDeskTabMetadata: metadata };
});
vi.mock("../NoActiveThreadState", () => ({ NoActiveThreadState: () => <p>No active chat</p> }));
vi.mock("../ChatView", async () => {
  const { useChatPane } = await import("../../chatPaneContext");
  return {
    default: function FixtureChatView({
      threadId,
      draftId,
      navigationSlot,
    }: {
      threadId: string;
      draftId?: string;
      navigationSlot?: import("react").ReactNode;
    }) {
      const pane = useChatPane();
      return (
        <div
          className="flex min-h-0 flex-1 flex-col"
          data-mock-chat={threadId}
          data-mock-draft={draftId}
          data-pane-active={pane.active}
          data-pane-visible={pane.visible}
        >
          {navigationSlot}
          <div className="p-3">
            <p>Existing chat {threadId}</p>
            <button
              type="button"
              aria-label={`Toggle rail ${threadId}`}
              aria-pressed={pane.sessionRailDocked === true}
              onClick={() => pane.onSessionRailDockedChange?.(!pane.sessionRailDocked)}
            >
              Rail
            </button>
            <label>
              Existing composer {threadId}
              <textarea aria-label={`Existing composer ${threadId}`} />
            </label>
          </div>
        </div>
      );
    },
  };
});

const environmentId = EnvironmentId.make("workspace-fixture");
const target = (id: string): ThreadRouteTarget => ({
  kind: "server",
  threadRef: { environmentId, threadId: ThreadId.make(id) },
});
const key = (id: string) => deskTabKey(target(id));
beforeEach(async () => {
  await page.viewport(1440, 900);
  useDeskStore.setState({ desk: createDeskState(environmentId) });
  mocks.params = {};
  mocks.primaryEnvironmentId = environmentId;
  mocks.composer.draftThreadsByThreadKey = {};
  mocks.environment = {
    bootstrapComplete: true,
    threadShellById: Object.fromEntries(
      ["one", "two", "three"].map((id) => [id, { id, archivedAt: null }]),
    ),
  };
  mocks.showMenu.mockReset();
  mocks.showMenu.mockResolvedValue(undefined);
  mocks.navigate.mockReset();
  mocks.navigate.mockImplementation(async (options) => {
    mocks.params = options.params ?? {};
    for (const notify of mocks.routeListeners) notify();
  });
  mocks.rename.mockClear();
  mocks.palette.mockClear();
});
afterEach(() => {
  useDeskStore.setState({ desk: createDeskState() });
  localStorage.removeItem(`cafe-code:desk:v1:${environmentId}`);
});

async function setup(ids = ["one", "two", "three"]) {
  ids.forEach((id) => useDeskStore.getState().dispatch({ type: "open", target: target(id) }));
  const host = document.createElement("div");
  host.style.width = "100%";
  document.body.append(host);
  const screen = await render(<DeskWorkspace />, { container: host });
  return {
    screen,
    host,
    async cleanup() {
      await screen.unmount();
      host.remove();
    },
  };
}

function browserPoint(point: { x: number; y: number }) {
  let { x, y } = point;
  let frame = window.frameElement;
  while (frame) {
    // The containing element belongs to another window's realm, so its
    // HTMLElement constructor is intentionally not this iframe's constructor.
    const frameElement = frame as HTMLElement;
    const rect = frameElement.getBoundingClientRect();
    // Vitest scales its test iframe to fit the runner's viewport. CDP uses
    // top-level coordinates, while DOM rectangles below use iframe CSS pixels.
    // Carry both offset and scale through every frame rather than landing a
    // nominal pane-center drag on a pane edge at a reduced runner scale.
    x = rect.left + (x + frameElement.clientLeft) * (rect.width / frameElement.offsetWidth);
    y = rect.top + (y + frameElement.clientTop) * (rect.height / frameElement.offsetHeight);
    frame = frame.ownerDocument.defaultView?.frameElement ?? null;
  }
  return { x, y };
}

/** PointerSensor needs an activation move and a subsequent measured move.
 * Playwright's generic HTML drag helper can jump directly to mouseup before
 * React publishes the activated droppable registry. Send real Chromium input
 * with frame boundaries, preserving the same pointer path as a user drag.
 */
async function dragPointer(
  source: Element,
  destination: { x: number; y: number },
  whileDragging?: (moveTo: (point: { x: number; y: number }) => Promise<void>) => Promise<void>,
) {
  const rect = source.getBoundingClientRect();
  const start = browserPoint({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
  const end = browserPoint(destination);
  const input: CDPSession = cdp();
  let releasePoint = end;
  const moveTo = async (point: { x: number; y: number }) => {
    releasePoint = browserPoint(point);
    await input.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      ...releasePoint,
      button: "left",
      buttons: 1,
    });
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  };
  await input.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...start });
  await input.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    ...start,
    button: "left",
    buttons: 1,
    clickCount: 1,
  });
  // Pointer down can activate the source pane. Let that ordinary React update
  // settle before crossing the activation threshold, as a physical drag does.
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  try {
    for (let step = 1; step <= 8; step += 1) {
      await input.send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: start.x + ((end.x - start.x) * step) / 8,
        y: start.y + ((end.y - start.y) * step) / 8,
        button: "left",
        buttons: 1,
      });
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    await whileDragging?.(moveTo);
  } finally {
    await input.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      ...releasePoint,
      button: "left",
      buttons: 0,
      clickCount: 1,
    });
    // dnd-kit intentionally suppresses clicks for 50ms after pointer release.
    // Let that documented sensor teardown finish before the next interaction
    // or test, instead of falsely treating the suppressed click as a UI bug.
    await new Promise<void>((resolve) => setTimeout(resolve, 75));
  }
}

function expectInsertionSlot(host: HTMLElement, strip: Element, index: number) {
  const markers = host.querySelectorAll<HTMLElement>("[data-desk-insertion-index]");
  expect(markers).toHaveLength(1);
  const marker = markers[0]!;
  expect(strip.contains(marker)).toBe(true);
  expect(marker.dataset.deskInsertionIndex).toBe(String(index));
  // Reordering is distinct from moving/splitting a pane. Assert the feedback
  // before release: checking only final order missed the misleading rectangle.
  expect(host.querySelector(".desk-drop-hint")).toBeNull();
  const markerBounds = marker.getBoundingClientRect();
  const stripBounds = strip.getBoundingClientRect();
  expect(markerBounds.left).toBeGreaterThanOrEqual(stripBounds.left - 2);
  expect(markerBounds.right).toBeLessThanOrEqual(stripBounds.right + 2);
}

describe("Desk workspace navigation chrome", () => {
  it.each(["cold", "last-selected"] as const)(
    "keeps a hidden queue host when the %s server candidate still belongs to a pending draft",
    async (mode) => {
      const pendingDraft = {
        environmentId,
        threadId: "draft-local-one",
        promotedTo: { environmentId, threadId: "one" },
      };
      if (mode === "cold") mocks.composer.draftThreadsByThreadKey = { pending: pendingDraft };
      const { host, cleanup } = await setup(mode === "cold" ? [] : ["one"]);
      try {
        if (mode === "last-selected") {
          useDeskStore.getState().dispatch({ type: "closeAll" });
          await vi.waitFor(() =>
            expect(
              host.querySelector('[data-mock-chat="one"][data-pane-visible="false"]'),
            ).not.toBeNull(),
          );
          mocks.composer.draftThreadsByThreadKey = { pending: pendingDraft };
          // Synthetic catalog updates are observed on the next ordinary render.
          useDeskStore.getState().dispatch({ type: "sidebarMode", mode: "desk" });
        }
        await vi.waitFor(() => {
          expect(host.querySelectorAll("[data-mock-chat]")).toHaveLength(1);
          const owner = host.querySelector('[data-mock-draft="pending"]');
          expect(owner).not.toBeNull();
          expect(owner?.getAttribute("data-pane-visible")).toBe("false");
          expect(owner?.getAttribute("data-pane-active")).toBe("false");
          expect(owner?.closest("[hidden][inert]")).not.toBeNull();
          expect(useDeskStore.getState().desk.groups.g1?.tabs).toEqual([]);
        });
      } finally {
        await cleanup();
      }
    },
  );

  it("drags the first tab after the last tab through the real pointer sensor", async () => {
    const { screen, host, cleanup } = await setup();
    try {
      const source = screen.getByRole("tab", { name: "Chat one", exact: true });
      const cell = screen
        .getByRole("tab", { name: "Chat three", exact: true })
        .element()
        .closest(".desk-tab-cell")!;
      const box = cell.getBoundingClientRect();
      await dragPointer(
        source.element(),
        { x: box.left + box.width * 0.65, y: box.top + box.height / 2 },
        async () => {
          await vi.waitFor(() =>
            expectInsertionSlot(
              host,
              screen.getByRole("tablist", { name: "Main tabs" }).element(),
              3,
            ),
          );
        },
      );
      await vi.waitFor(() =>
        expect(useDeskStore.getState().desk.groups.g1?.tabs).toEqual([
          key("two"),
          key("three"),
          key("one"),
        ]),
      );
      expect(host.querySelector("[data-desk-insertion-index]")).toBeNull();
      expect(deskGroupIds(useDeskStore.getState().desk.layout)).toEqual(["g1"]);
    } finally {
      await cleanup();
    }
  });

  it.each([80, 100, 130])(
    "updates before/after slots within one hovered tab and reorders in the middle at %i percent scale",
    async (scale) => {
      const previous = document.documentElement.style.fontSize;
      applyInterfaceScalePercent(scale);
      const { screen, host, cleanup } = await setup();
      try {
        const strip = screen.getByRole("tablist", { name: "Main tabs" }).element();
        const cell = screen
          .getByRole("tab", { name: "Chat two", exact: true })
          .element()
          .closest(".desk-tab-cell")!;
        const box = cell.getBoundingClientRect();
        const before = { x: box.left + box.width * 0.25, y: box.top + box.height / 2 };
        const after = { x: box.left + box.width * 0.75, y: before.y };
        await dragPointer(
          screen.getByRole("tab", { name: "Chat one", exact: true }).element(),
          before,
          async (moveTo) => {
            await vi.waitFor(() => expectInsertionSlot(host, strip, 1));
            const firstBoundary = host
              .querySelector<HTMLElement>("[data-desk-insertion-index]")!
              .getBoundingClientRect().left;
            // The target ID does not change across its midpoint. Both the slot
            // and final move must follow the new side without an onDragOver.
            await moveTo(after);
            await vi.waitFor(() => {
              expectInsertionSlot(host, strip, 2);
              expect(
                host
                  .querySelector<HTMLElement>("[data-desk-insertion-index]")!
                  .getBoundingClientRect().left,
              ).toBeGreaterThan(firstBoundary);
            });
            await moveTo(before);
            await vi.waitFor(() => expectInsertionSlot(host, strip, 1));
            await moveTo(after);
            await vi.waitFor(() => expectInsertionSlot(host, strip, 2));
          },
        );
        expect(useDeskStore.getState().desk.groups.g1?.tabs).toEqual([
          key("two"),
          key("one"),
          key("three"),
        ]);
        expect(deskGroupIds(useDeskStore.getState().desk.layout)).toEqual(["g1"]);
        expect(host.querySelector("[data-desk-insertion-index]")).toBeNull();
        expect(host.querySelector(".desk-drop-hint")).toBeNull();
      } finally {
        await cleanup();
        document.documentElement.style.fontSize = previous;
      }
    },
  );

  it("shows a start slot and moves the last tab before the first without splitting", async () => {
    const { screen, host, cleanup } = await setup();
    try {
      const strip = screen.getByRole("tablist", { name: "Main tabs" }).element();
      const box = screen
        .getByRole("tab", { name: "Chat one", exact: true })
        .element()
        .closest(".desk-tab-cell")!
        .getBoundingClientRect();
      await dragPointer(
        screen.getByRole("tab", { name: "Chat three", exact: true }).element(),
        { x: box.left + box.width * 0.25, y: box.top + box.height / 2 },
        async () => {
          await vi.waitFor(() => expectInsertionSlot(host, strip, 0));
        },
      );
      expect(useDeskStore.getState().desk.groups.g1?.tabs).toEqual([
        key("three"),
        key("one"),
        key("two"),
      ]);
      expect(deskGroupIds(useDeskStore.getState().desk.layout)).toEqual(["g1"]);
    } finally {
      await cleanup();
    }
  });

  it("shows an append slot over unused strip space without a pane preview", async () => {
    const { screen, host, cleanup } = await setup();
    try {
      const strip = screen.getByRole("tablist", { name: "Main tabs" }).element();
      const stripBox = strip.getBoundingClientRect();
      const last = screen
        .getByRole("tab", { name: "Chat three", exact: true })
        .element()
        .closest(".desk-tab-cell")!
        .getBoundingClientRect();
      expect(stripBox.right - last.right).toBeGreaterThan(20);
      await dragPointer(
        screen.getByRole("tab", { name: "Chat one", exact: true }).element(),
        { x: last.right + 12, y: stripBox.top + stripBox.height / 2 },
        async () => {
          await vi.waitFor(() => expectInsertionSlot(host, strip, 3));
        },
      );
      expect(useDeskStore.getState().desk.groups.g1?.tabs).toEqual([
        key("two"),
        key("three"),
        key("one"),
      ]);
      expect(deskGroupIds(useDeskStore.getState().desk.layout)).toEqual(["g1"]);
    } finally {
      await cleanup();
    }
  });

  it("inserts into another group's tab strip without creating a split", async () => {
    const { screen, host, cleanup } = await setup();
    try {
      mocks.showMenu.mockResolvedValueOnce("split-right");
      await screen.getByRole("button", { name: "Main tab actions" }).click();
      const strip = screen.getByRole("tablist", { name: "Group 2 tabs" }).element();
      const box = screen
        .getByRole("tab", { name: "Chat three", exact: true })
        .element()
        .closest(".desk-tab-cell")!
        .getBoundingClientRect();
      await dragPointer(
        screen.getByRole("tab", { name: "Chat one", exact: true }).element(),
        { x: box.left + box.width * 0.25, y: box.top + box.height / 2 },
        async () => {
          await vi.waitFor(() => expectInsertionSlot(host, strip, 0));
        },
      );
      expect(useDeskStore.getState().desk.groups.g1?.tabs).toEqual([key("two")]);
      expect(useDeskStore.getState().desk.groups.g2?.tabs).toEqual([key("one"), key("three")]);
      expect(deskGroupIds(useDeskStore.getState().desk.layout)).toEqual(["g1", "g2"]);
      expect(host.querySelector("[data-desk-insertion-index]")).toBeNull();
    } finally {
      await cleanup();
    }
  });

  it.each(["Escape", "outside"] as const)(
    "clears an insertion slot on %s without moving the tab",
    async (cancel) => {
      const { screen, host, cleanup } = await setup();
      try {
        host.style.width = "calc(100% - 180px)";
        const strip = screen.getByRole("tablist", { name: "Main tabs" }).element();
        const box = screen
          .getByRole("tab", { name: "Chat two", exact: true })
          .element()
          .closest(".desk-tab-cell")!
          .getBoundingClientRect();
        const before = useDeskStore.getState().desk.groups.g1?.tabs;
        await dragPointer(
          screen.getByRole("tab", { name: "Chat one", exact: true }).element(),
          { x: box.left + box.width * 0.75, y: box.top + box.height / 2 },
          async (moveTo) => {
            await vi.waitFor(() => expectInsertionSlot(host, strip, 2));
            if (cancel === "Escape") await userEvent.keyboard("{Escape}");
            else
              await moveTo({
                x: host.getBoundingClientRect().right + 8,
                y: box.top + box.height / 2,
              });
            await vi.waitFor(() => {
              expect(host.querySelector("[data-desk-insertion-index]")).toBeNull();
              expect(host.querySelector(".desk-drop-hint")).toBeNull();
            });
          },
        );
        expect(useDeskStore.getState().desk.groups.g1?.tabs).toEqual(before);
        expect(deskGroupIds(useDeskStore.getState().desk.layout)).toEqual(["g1"]);
      } finally {
        await cleanup();
      }
    },
  );

  it.each([80, 130])(
    "keeps insertion slots aligned after overflow scrolling at %i percent scale",
    async (scale) => {
      const previous = document.documentElement.style.fontSize;
      applyInterfaceScalePercent(scale);
      const ids = Array.from({ length: 12 }, (_, index) => `overflow-${index}`);
      mocks.environment.threadShellById = Object.fromEntries(
        ids.map((id) => [id, { id, archivedAt: null }]),
      );
      const { screen, host, cleanup } = await setup(ids);
      try {
        host.style.width = "680px";
        const strip = screen.getByRole("tablist", { name: "Main tabs" }).element() as HTMLElement;
        const source = screen.getByRole("tab", { name: "Chat overflow-11", exact: true }).element();
        // Resizing the fixture schedules the same selected-tab reveal as the
        // real UI. Wait for that observer before measuring a physical gesture;
        // a positive old scroll offset alone does not mean the source is visible.
        await vi.waitFor(() => {
          expect(strip.scrollLeft).toBeGreaterThan(0);
          const sourceBounds = source.getBoundingClientRect();
          const viewport = strip.getBoundingClientRect();
          expect(sourceBounds.left).toBeGreaterThanOrEqual(viewport.left);
          expect(sourceBounds.right).toBeLessThanOrEqual(viewport.right + 1);
        });
        const targetCell = screen
          .getByRole("tab", { name: "Chat overflow-10", exact: true })
          .element()
          .closest(".desk-tab-cell")!;
        const box = targetCell.getBoundingClientRect();
        await dragPointer(
          source,
          { x: box.left + box.width * 0.25, y: box.top + box.height / 2 },
          async (moveTo) => {
            await vi.waitFor(() => expectInsertionSlot(host, strip, 10));
            // Scroll during the active drag. dnd-kit's measured tab rectangles
            // follow the scroll; the raw pointer must not gain its scroll delta.
            strip.scrollLeft -= 40;
            await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
            const shifted = targetCell.getBoundingClientRect();
            await moveTo({
              x: shifted.left + shifted.width * 0.25,
              y: shifted.top + shifted.height / 2,
            });
            await vi.waitFor(() => {
              expectInsertionSlot(host, strip, 10);
              const marker = host
                .querySelector<HTMLElement>("[data-desk-insertion-index]")!
                .getBoundingClientRect();
              expect(Math.abs(marker.left - targetCell.getBoundingClientRect().left)).toBeLessThan(
                3,
              );
            });
          },
        );
        expect(useDeskStore.getState().desk.groups.g1?.tabs).toEqual(
          [...ids.slice(0, 10), ids[11]!, ids[10]!].map(key),
        );
        expect(deskGroupIds(useDeskStore.getState().desk.layout)).toEqual(["g1"]);
        expect(host.querySelector("[data-desk-insertion-index]")).toBeNull();
      } finally {
        await cleanup();
        document.documentElement.style.fontSize = previous;
      }
    },
  );

  it.each(["left", "right"] as const)(
    "clamps a partially clipped %s insertion boundary inside the strip without shifting tabs",
    async (side) => {
      const ids = Array.from({ length: 12 }, (_, index) => `clipped-${index}`);
      mocks.environment.threadShellById = Object.fromEntries(
        ids.map((id) => [id, { id, archivedAt: null }]),
      );
      const { screen, host, cleanup } = await setup(ids);
      try {
        host.style.width = "680px";
        const strip = screen.getByRole("tablist", { name: "Main tabs" }).element() as HTMLElement;
        const source = screen.getByRole("tab", { name: "Chat clipped-10", exact: true }).element();
        await vi.waitFor(() => {
          const bounds = source.getBoundingClientRect();
          const viewport = strip.getBoundingClientRect();
          expect(bounds.left).toBeGreaterThanOrEqual(viewport.left);
          expect(bounds.right).toBeLessThanOrEqual(viewport.right);
        });
        const pane = screen
          .getByRole("region", { name: "Main chat group" })
          .element()
          .getBoundingClientRect();
        const before = useDeskStore.getState().desk.groups.g1?.tabs;
        await dragPointer(
          source,
          { x: pane.left + pane.width / 2, y: pane.top + pane.height / 2 },
          async (moveTo) => {
            // Choose an earlier tab on the left so the requested clipping is
            // reachable before the strip hits its maximum scroll offset.
            const targetIndex = side === "left" ? 7 : 8;
            const cell = screen
              .getByRole("tab", { name: `Chat clipped-${targetIndex}`, exact: true })
              .element()
              .closest(".desk-tab-cell")!;
            const viewport = strip.getBoundingClientRect();
            const original = cell.getBoundingClientRect();
            const desiredLeft =
              side === "left"
                ? viewport.left - original.width * 0.25
                : viewport.right - original.width * 0.75;
            strip.scrollLeft += original.left - desiredLeft;
            await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
            const clipped = cell.getBoundingClientRect();
            if (side === "left") expect(clipped.left).toBeLessThan(viewport.left);
            else expect(clipped.right).toBeGreaterThan(viewport.right);
            const stablePosition = clipped.left - viewport.left + strip.scrollLeft;
            const expectedIndex = targetIndex + (side === "right" ? 1 : 0);
            await moveTo({
              x:
                side === "left"
                  ? viewport.left + clipped.width * 0.1
                  : viewport.right - clipped.width * 0.1,
              y: clipped.top + clipped.height / 2,
            });
            await vi.waitFor(() => expectInsertionSlot(host, strip, expectedIndex));
            // The sensor deliberately auto-scrolls near an edge. Restore the
            // exact partial clip after its target-change effects settle, then
            // inspect sticky CSS synchronously before the next scroll tick.
            // The pointer remains over the same visible half of this tab.
            strip.scrollLeft += cell.getBoundingClientRect().left - desiredLeft;
            {
              expectInsertionSlot(host, strip, expectedIndex);
              const marker = host.querySelector<HTMLElement>("[data-desk-insertion-index]")!;
              const bounds = marker.getBoundingClientRect();
              const currentViewport = strip.getBoundingClientRect();
              const currentCell = cell.getBoundingClientRect();
              const paintedWidth = Number.parseFloat(getComputedStyle(marker, "::before").width);
              expect(paintedWidth).toBe(2);
              expect(bounds.left).toBeGreaterThanOrEqual(currentViewport.left);
              expect(bounds.left + paintedWidth).toBeLessThanOrEqual(currentViewport.right + 0.5);
              if (side === "left") expect(currentCell.left).toBeLessThan(currentViewport.left);
              else expect(currentCell.right).toBeGreaterThan(currentViewport.right);
              // Auto-scroll may move the viewport, but introducing feedback must
              // not move or resize the underlying tab in strip-content space.
              expect(Math.abs(currentCell.width - clipped.width)).toBeLessThan(1);
              expect(
                Math.abs(
                  currentCell.left - currentViewport.left + strip.scrollLeft - stablePosition,
                ),
              ).toBeLessThan(1);
            }
            await userEvent.keyboard("{Escape}");
            await vi.waitFor(() =>
              expect(host.querySelector("[data-desk-insertion-index]")).toBeNull(),
            );
          },
        );
        expect(useDeskStore.getState().desk.groups.g1?.tabs).toEqual(before);
        expect(deskGroupIds(useDeskStore.getState().desk.layout)).toEqual(["g1"]);
      } finally {
        await cleanup();
      }
    },
  );

  it("moves a tab to another pane center without accidentally splitting", async () => {
    const { screen, cleanup } = await setup();
    try {
      mocks.showMenu.mockResolvedValueOnce("split-right");
      await screen.getByRole("button", { name: "Main tab actions" }).click();
      const pane = screen.getByRole("region", { name: "Group 2 chat group" });
      await expect.element(pane).toBeVisible();
      const box = pane.element().getBoundingClientRect();
      await dragPointer(screen.getByRole("tab", { name: "Chat one", exact: true }).element(), {
        x: box.left + box.width / 2,
        y: box.top + box.height / 2,
      });
      await vi.waitFor(() =>
        expect(useDeskStore.getState().desk.groups.g2?.tabs).toEqual([key("three"), key("one")]),
      );
      expect(deskGroupIds(useDeskStore.getState().desk.layout)).toEqual(["g1", "g2"]);
    } finally {
      await cleanup();
    }
  });

  it("splits at a pane edge through pointer dragging", async () => {
    const { screen, cleanup } = await setup();
    try {
      const pane = screen.getByRole("region", { name: "Main chat group" });
      const box = pane.element().getBoundingClientRect();
      await dragPointer(screen.getByRole("tab", { name: "Chat one", exact: true }).element(), {
        x: box.left + 5,
        y: box.top + box.height / 2,
      });
      await vi.waitFor(() =>
        expect(deskGroupIds(useDeskStore.getState().desk.layout)).toEqual(["g2", "g1"]),
      );
      expect(useDeskStore.getState().desk.groups.g2?.tabs).toEqual([key("one")]);
      expect(useDeskStore.getState().desk.groups.g1?.tabs).toEqual([key("two"), key("three")]);
    } finally {
      await cleanup();
    }
  });

  it.each([80, 100, 130])(
    "refreshes center/edge previews within the same pane before release at %i percent scale",
    async (scale) => {
      const previous = document.documentElement.style.fontSize;
      applyInterfaceScalePercent(scale);
      const { screen, cleanup } = await setup();
      try {
        mocks.showMenu.mockResolvedValueOnce("split-right");
        await screen.getByRole("button", { name: "Main tab actions" }).click();
        const pane = screen.getByRole("region", { name: "Group 2 chat group" });
        await expect.element(pane).toBeVisible();
        const box = pane.element().getBoundingClientRect();
        const center = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
        await dragPointer(
          screen.getByRole("tab", { name: "Chat one", exact: true }).element(),
          center,
          async (moveTo) => {
            const preview = () => pane.element().querySelector<HTMLElement>(".desk-drop-hint");
            await vi.waitFor(() => expect(preview()?.dataset.edge).toBe("center"));
            // Never leave this droppable pane: onDragOver alone cannot observe
            // these transitions. Test the visible preview before pointerup,
            // not just the reducer result that previously hid this regression.
            for (const [edge, point] of [
              ["left", { x: box.left + 5, y: center.y }],
              ["right", { x: box.right - 5, y: center.y }],
              ["top", { x: center.x, y: box.top + box.height * 0.12 }],
              ["bottom", { x: center.x, y: box.bottom - 5 }],
              ["center", center],
              ["left", { x: box.left + 5, y: center.y }],
            ] as const) {
              await moveTo(point);
              await vi.waitFor(() => expect(preview()?.dataset.edge).toBe(edge));
              const bounds = preview()!.getBoundingClientRect();
              const horizontal = edge === "left" || edge === "right";
              const vertical = edge === "top" || edge === "bottom";
              expect(Math.abs(bounds.width - (box.width - 2) / (horizontal ? 2 : 1))).toBeLessThan(
                2,
              );
              expect(Math.abs(bounds.height - (box.height - 2) / (vertical ? 2 : 1))).toBeLessThan(
                2,
              );
            }
          },
        );
        expect(deskGroupIds(useDeskStore.getState().desk.layout)).toEqual(["g1", "g3", "g2"]);
        expect(useDeskStore.getState().desk.groups.g3?.tabs).toEqual([key("one")]);
      } finally {
        await cleanup();
        document.documentElement.style.fontSize = previous;
      }
    },
  );

  it("clears the preview and does not move a tab when released outside the workspace", async () => {
    const { screen, host, cleanup } = await setup();
    try {
      // Leave room for a real pointer outside the pane but still in the page.
      // The dragged tab rectangle still overlaps the pane there, which must
      // never substitute for an actual pointer hit.
      host.style.width = "calc(100% - 180px)";
      const pane = screen.getByRole("region", { name: "Main chat group" });
      const box = pane.element().getBoundingClientRect();
      const before = useDeskStore.getState().desk.groups.g1?.tabs;
      await dragPointer(
        screen.getByRole("tab", { name: "Chat one", exact: true }).element(),
        { x: box.left + box.width / 2, y: box.top + box.height / 2 },
        async (moveTo) => {
          await vi.waitFor(() => expect(host.querySelector(".desk-drop-hint")).not.toBeNull());
          await moveTo({ x: box.right + 8, y: box.top + box.height / 2 });
          await vi.waitFor(() => expect(host.querySelector(".desk-drop-hint")).toBeNull());
        },
      );
      expect(useDeskStore.getState().desk.groups.g1?.tabs).toEqual(before);
      expect(deskGroupIds(useDeskStore.getState().desk.layout)).toEqual(["g1"]);
    } finally {
      await cleanup();
    }
  });

  it("keeps local chat overlays below the drag preview and clears it on Escape", async () => {
    const { screen, host, cleanup } = await setup();
    try {
      const chat = host.querySelector<HTMLElement>('[data-mock-chat="three"]')!;
      const overlay = document.createElement("div");
      // Model the existing subagent panel's full-pane, opaque z-40 surface.
      overlay.style.cssText = "position:absolute;inset:50px 0 0;z-index:40;background:black";
      chat.append(overlay);
      const box = chat.getBoundingClientRect();
      const before = useDeskStore.getState().desk.groups.g1?.tabs;
      await dragPointer(
        screen.getByRole("tab", { name: "Chat one", exact: true }).element(),
        { x: box.left + 5, y: box.top + box.height / 2 },
        async () => {
          await vi.waitFor(() =>
            expect(host.querySelector<HTMLElement>(".desk-drop-hint")?.dataset.edge).toBe("left"),
          );
          const hint = host.querySelector<HTMLElement>(".desk-drop-hint")!;
          expect(hint.parentElement).toBe(chat.parentElement);
          expect(getComputedStyle(chat).isolation).toBe("isolate");
          expect(getComputedStyle(chat).zIndex).toBe("auto");
          expect(Number(getComputedStyle(hint).zIndex)).toBeGreaterThan(0);
          await userEvent.keyboard("{Escape}");
          await vi.waitFor(() => expect(host.querySelector(".desk-drop-hint")).toBeNull());
        },
      );
      expect(useDeskStore.getState().desk.groups.g1?.tabs).toEqual(before);
    } finally {
      await cleanup();
    }
  });

  it.each([80, 130])("keeps navigation bounded at %i percent interface scale", async (scale) => {
    const previous = document.documentElement.style.fontSize;
    applyInterfaceScalePercent(scale);
    const { screen, host, cleanup } = await setup();
    try {
      mocks.showMenu.mockResolvedValueOnce("split-right");
      await screen.getByRole("button", { name: "Main tab actions" }).click();
      await expect
        .element(screen.getByRole("region", { name: "Group 2 chat group" }))
        .toBeVisible();
      for (const bar of host.querySelectorAll<HTMLElement>(".desk-group-bar")) {
        const bounds = bar.getBoundingClientRect();
        expect(bounds.height).toBeLessThanOrEqual((32 * scale) / 100 + 1);
        expect(bounds.width).toBeLessThanOrEqual(
          bar.closest(".desk-pane")!.getBoundingClientRect().width,
        );
      }
      expect(host.scrollWidth).toBeLessThanOrEqual(host.clientWidth + 1);
      // Screenshots are opt-in local evidence; CI/default runs do not create
      // private exploration artifacts or write outside their checkout.
      if (import.meta.env.VITE_DESK_CAPTURE_PRIVATE === "1") {
        await page.screenshot({
          path: `../../../../../.explorations/desk-implementation/desk-chrome-${scale}.png`,
        });
      }
    } finally {
      await cleanup();
      document.documentElement.style.fontSize = previous;
    }
  });

  it("retains the newest tab selection while an older route echo arrives", async () => {
    const { screen, cleanup } = await setup();
    const pending: Array<{ params: Record<string, string>; finish: () => void }> = [];
    try {
      await vi.waitFor(() => expect(mocks.params.threadId).toBe("three"));
      mocks.navigate.mockImplementation(
        (options) =>
          new Promise<void>((resolve) => {
            pending.push({ params: options.params ?? {}, finish: resolve });
          }),
      );
      await screen.getByRole("tab", { name: "Chat one", exact: true }).click();
      await screen.getByRole("tab", { name: "Chat two", exact: true }).click();
      // Route writes may be serialized; a second tab choice stays in Desk
      // state until the outstanding navigation echo is safely reconciled.
      await vi.waitFor(() => expect(pending.length).toBeGreaterThanOrEqual(1));
      expect(useDeskStore.getState().desk.groups.g1?.activeTabKey).toBe(key("two"));
      const old = pending.find((entry) => entry.params.threadId === "one")!;
      mocks.params = old.params;
      for (const notify of mocks.routeListeners) notify();
      old.finish();
      await vi.waitFor(() =>
        expect(pending.some((entry) => entry.params.threadId === "two")).toBe(true),
      );
      expect(useDeskStore.getState().desk.groups.g1?.activeTabKey).toBe(key("two"));
      const latest = pending.find((entry) => entry.params.threadId === "two")!;
      mocks.params = latest.params;
      for (const notify of mocks.routeListeners) notify();
      latest.finish();
      await expect
        .element(screen.getByRole("tab", { name: "Chat two", exact: true }))
        .toHaveAttribute("aria-selected", "true");
    } finally {
      for (const entry of pending) entry.finish();
      await cleanup();
    }
  });

  it("does not prune on reconnect uncertainty and retires archived views only from an authoritative inventory", async () => {
    const { screen, host, cleanup } = await setup();
    try {
      await vi.waitFor(() => expect(mocks.params.threadId).toBe("three"));
      const saved = mocks.environment.threadShellById;
      mocks.environment = { bootstrapComplete: false, threadShellById: {} };
      mocks.params = { ...mocks.params };
      for (const notify of mocks.routeListeners) notify();
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      expect(useDeskStore.getState().desk.groups.g1?.tabs).toEqual([
        key("one"),
        key("two"),
        key("three"),
      ]);
      mocks.environment = {
        bootstrapComplete: true,
        threadShellById: {
          ...saved,
          three: { id: "three", archivedAt: "2026-09-29T00:00:00.000Z" },
        },
      };
      mocks.params = { ...mocks.params };
      for (const notify of mocks.routeListeners) notify();
      await vi.waitFor(() =>
        expect(useDeskStore.getState().desk.groups.g1?.tabs).toEqual([key("one"), key("two")]),
      );
      await expect
        .element(screen.getByRole("textbox", { name: "Existing composer two" }))
        .toBeVisible();
      expect(host.querySelector('[data-mock-chat="three"]')).toBeNull();
    } finally {
      await cleanup();
    }
  });

  it("unmounts old-environment panes immediately when the authenticated environment changes", async () => {
    const { host, cleanup } = await setup();
    try {
      await vi.waitFor(() => expect(mocks.params.threadId).toBe("three"));
      mocks.primaryEnvironmentId = "other-fixture";
      mocks.environment = { bootstrapComplete: false, threadShellById: {} };
      mocks.params = {};
      for (const notify of mocks.routeListeners) notify();
      await vi.waitFor(() =>
        expect(useDeskStore.getState().desk.environmentId).toBe("other-fixture"),
      );
      expect(host.querySelectorAll("[data-mock-chat]")).toHaveLength(0);
      expect(Object.keys(useDeskStore.getState().desk.targets)).toHaveLength(0);
    } finally {
      await cleanup();
      localStorage.removeItem("cafe-code:desk:v1:other-fixture");
    }
  });

  it("does not reopen a closed tab from its route echo and admits an explicit later deep link", async () => {
    const { screen, cleanup } = await setup();
    try {
      await vi.waitFor(() => expect(mocks.params.threadId).toBe("three"));
      await screen.getByRole("tab", { name: "Chat one", exact: true }).click();
      await vi.waitFor(() => expect(mocks.params.threadId).toBe("one"));
      await screen.getByRole("button", { name: "Close tab Chat one" }).click();
      await vi.waitFor(() => expect(mocks.params.threadId).toBe("two"));
      expect(useDeskStore.getState().desk.groups.g1?.tabs).toEqual([key("two"), key("three")]);
      // A later independent history/deep-link change is different from the
      // expected navigation echo and is allowed to open that chat again.
      mocks.params = { environmentId, threadId: "one" };
      for (const notify of mocks.routeListeners) notify();
      await expect
        .element(screen.getByRole("tab", { name: "Chat one", exact: true }))
        .toBeVisible();
      expect(useDeskStore.getState().desk.groups.g1?.activeTabKey).toBe(key("one"));
      const tabs = useDeskStore.getState().desk.groups.g1?.tabs;
      mocks.params = { environmentId: "other-environment", threadId: "one" };
      for (const notify of mocks.routeListeners) notify();
      await vi.waitFor(() => expect(mocks.params.environmentId).toBe(environmentId));
      expect(useDeskStore.getState().desk.groups.g1?.tabs).toEqual(tabs);
    } finally {
      await cleanup();
    }
  });

  it("keeps compact tab chrome and existing chat content while selecting with click and keyboard", async () => {
    const { screen, host, cleanup } = await setup();
    try {
      expect(
        host.querySelector(".desk-group-bar")!.getBoundingClientRect().height,
      ).toBeLessThanOrEqual(34);
      await screen.getByRole("tab", { name: "Chat one", exact: true }).click();
      await expect
        .element(screen.getByRole("textbox", { name: "Existing composer one" }))
        .toBeVisible();
      await expect
        .element(screen.getByRole("tab", { name: "Chat one", exact: true }))
        .toHaveFocus();
      await userEvent.keyboard("{ArrowRight}");
      expect(useDeskStore.getState().desk.groups.g1?.activeTabKey).toBe(key("two"));
      await expect
        .element(screen.getByRole("tab", { name: "Chat two", exact: true }))
        .toHaveAttribute("aria-selected", "true");
      await expect
        .element(screen.getByRole("tab", { name: "Chat two", exact: true }))
        .toHaveFocus();
      await userEvent.keyboard("{End}");
      expect(useDeskStore.getState().desk.groups.g1?.activeTabKey).toBe(key("three"));
      expect(host.querySelectorAll('[data-mock-chat][data-pane-active="true"]')).toHaveLength(1);
    } finally {
      await cleanup();
    }
  });

  it("provides context close-right, close-others, close-all and reopen without chat mutations", async () => {
    const { screen, host, cleanup } = await setup();
    try {
      await screen.getByRole("tab", { name: "Chat two", exact: true }).click();
      mocks.showMenu.mockResolvedValueOnce("right");
      screen
        .getByRole("tab", { name: "Chat two", exact: true })
        .element()
        .dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 250, clientY: 25 }));
      await vi.waitFor(() =>
        expect(useDeskStore.getState().desk.groups.g1?.tabs).toEqual([key("one"), key("two")]),
      );
      expect(mocks.showMenu.mock.calls[0]?.[0].map((item) => item.label)).toEqual(
        expect.arrayContaining([
          "Close tab",
          "Close other tabs",
          "Close tabs to the right",
          "Close all tabs in group",
          "Close all tabs",
          "Reopen closed tab",
        ]),
      );
      mocks.showMenu.mockResolvedValueOnce("others");
      await screen.getByRole("button", { name: "Main tab actions" }).click();
      await vi.waitFor(() =>
        expect(useDeskStore.getState().desk.groups.g1?.tabs).toEqual([key("two")]),
      );
      mocks.showMenu.mockResolvedValueOnce("close-all");
      await screen.getByRole("button", { name: "Main tab actions" }).click();
      await expect.element(screen.getByText("No active chat", { exact: true })).toBeVisible();
      expect(host.querySelectorAll('[data-mock-chat][data-pane-active="true"]')).toHaveLength(0);
      await screen.getByRole("button", { name: "Reopen closed tab", exact: true }).click();
      await expect
        .element(screen.getByRole("tab", { name: "Chat two", exact: true }))
        .toBeVisible();
      expect(mocks.rename).not.toHaveBeenCalled();
    } finally {
      await cleanup();
    }
  });

  it("splits existing tabs, keeps rail pinning independent, moves tabs and merges groups", async () => {
    const { screen, host, cleanup } = await setup();
    try {
      mocks.showMenu.mockResolvedValueOnce("split-right");
      await screen.getByRole("button", { name: "Main tab actions" }).click();
      await expect
        .element(screen.getByRole("region", { name: "Group 2 chat group" }))
        .toBeVisible();
      expect(deskGroupIds(useDeskStore.getState().desk.layout)).toEqual(["g1", "g2"]);
      await screen.getByRole("button", { name: "Toggle rail three" }).click();
      expect(useDeskStore.getState().desk.groups.g2?.sessionRailDocked).toBe(false);
      expect(useDeskStore.getState().desk.groups.g1?.sessionRailDocked).toBeNull();
      await expect
        .element(screen.getByRole("button", { name: "Toggle rail two" }))
        .toHaveAttribute("aria-pressed", "true");
      mocks.showMenu.mockResolvedValueOnce("session-rail");
      await screen.getByRole("button", { name: "Group 2 tab actions" }).click();
      await vi.waitFor(() =>
        expect(useDeskStore.getState().desk.groups.g2?.sessionRailDocked).toBe(true),
      );
      expect(useDeskStore.getState().desk.groups.g1?.sessionRailDocked).toBeNull();
      expect(host.querySelectorAll('[data-mock-chat][data-pane-active="true"]')).toHaveLength(1);
      mocks.showMenu.mockResolvedValueOnce("move-g2");
      await screen.getByRole("button", { name: "Main tab actions" }).click();
      await vi.waitFor(() =>
        expect(useDeskStore.getState().desk.groups.g2?.tabs).toEqual([key("three"), key("two")]),
      );
      mocks.showMenu.mockResolvedValueOnce("merge-g1");
      await screen.getByRole("button", { name: "Group 2 tab actions" }).click();
      await vi.waitFor(() =>
        expect(deskGroupIds(useDeskStore.getState().desk.layout)).toEqual(["g1"]),
      );
      expect(useDeskStore.getState().desk.groups.g1?.tabs).toEqual([
        key("one"),
        key("three"),
        key("two"),
      ]);
    } finally {
      await cleanup();
    }
  });

  it("supports group rename, overflow selection, focus restore and keyboard resize", async () => {
    const { screen, cleanup } = await setup();
    try {
      await screen.getByRole("button", { name: "Main", exact: true }).click();
      await screen.getByRole("textbox", { name: "Group name" }).fill("Proof pipeline");
      await screen.getByRole("button", { name: "Save", exact: true }).click();
      await screen.getByRole("button", { name: "All tabs in Proof pipeline" }).click();
      await screen.getByRole("searchbox", { name: "Search open tabs" }).fill("one");
      await screen.getByRole("button", { name: "Chat one Fixture project" }).click();
      expect(useDeskStore.getState().desk.groups.g1?.activeTabKey).toBe(key("one"));
      mocks.showMenu.mockResolvedValueOnce("split-bottom");
      await screen.getByRole("button", { name: "Proof pipeline tab actions" }).click();
      const separator = screen.getByRole("separator", { name: "Resize chat groups" });
      await expect.element(separator).toHaveAttribute("aria-valuenow", "50");
      separator
        .element()
        .dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
      await expect.element(separator).toHaveAttribute("aria-valuenow", "55");
      await screen.getByRole("button", { name: "Focus Group 2", exact: true }).click();
      expect(useDeskStore.getState().desk.focusedGroupId).toBe("g2");
      await screen.getByRole("button", { name: "Restore layout", exact: true }).click();
      await expect.element(separator).toBeVisible();
      expect(useDeskStore.getState().desk.focusedGroupId).toBeNull();
    } finally {
      await cleanup();
    }
  });

  it("keeps F2 rename available without a pencil on the tab strip", async () => {
    const { screen, cleanup } = await setup(["one"]);
    try {
      await expect
        .element(screen.getByRole("button", { name: "Rename Chat one" }))
        .not.toBeInTheDocument();
      await screen.getByRole("tab", { name: "Chat one", exact: true }).click();
      await userEvent.keyboard("{F2}");
      await screen.getByRole("textbox", { name: "Chat title" }).fill("Renamed chat");
      await screen.getByRole("button", { name: "Save", exact: true }).click();
      await expect.element(screen.getByRole("dialog")).not.toBeInTheDocument();
      expect(mocks.rename).toHaveBeenCalledExactlyOnceWith(
        { environmentId, threadId: "one" },
        "Renamed chat",
        "Chat one",
      );
      expect(mocks.showMenu).not.toHaveBeenCalled();
    } finally {
      await cleanup();
    }
  });

  it("shows only an always-visible close action on both selected and unselected tabs", async () => {
    const { screen, host, cleanup } = await setup();
    try {
      // Put the pointer outside the strip: visibility cannot depend on hover
      // or on the tab being selected. Sidebar pencil controls are unaffected.
      await screen.getByRole("textbox", { name: "Existing composer three" }).hover();
      expect(host.querySelectorAll('.desk-tab-cell button[aria-label^="Rename "]')).toHaveLength(0);
      expect(host.querySelectorAll(".desk-tab-action")).toHaveLength(3);
      for (const id of ["one", "two", "three"]) {
        const close = screen.getByRole("button", { name: `Close tab Chat ${id}` });
        await expect.element(close).toBeVisible();
        const button = close.element();
        const cell = button.closest(".desk-tab-cell")!;
        expect(getComputedStyle(button).opacity).toBe("1");
        expect(getComputedStyle(cell).opacity).toBe("1");
        const bounds = button.getBoundingClientRect();
        const cellBounds = cell.getBoundingClientRect();
        expect(bounds.left).toBeGreaterThanOrEqual(cellBounds.left);
        expect(bounds.right).toBeLessThanOrEqual(cellBounds.right);
      }
      await screen.getByRole("button", { name: "Close tab Chat one" }).click();
      expect(useDeskStore.getState().desk.groups.g1?.tabs).toEqual([key("two"), key("three")]);
      expect(mocks.rename).not.toHaveBeenCalled();
    } finally {
      await cleanup();
    }
  });

  it("reveals the selected tab's X as well as its title in an overflowing strip", async () => {
    const ids = Array.from({ length: 12 }, (_, index) => `overflow-${index}`);
    mocks.environment.threadShellById = Object.fromEntries(
      ids.map((id) => [id, { id, archivedAt: null }]),
    );
    const { screen, host, cleanup } = await setup(ids);
    try {
      host.style.width = "560px";
      const strip = screen.getByRole("tablist", { name: "Main tabs" });
      await vi.waitFor(() =>
        expect(strip.element().scrollWidth).toBeGreaterThan(strip.element().clientWidth),
      );
      const lastTab = screen.getByRole("tab", { name: "Chat overflow-11", exact: true });
      await lastTab.click();
      await userEvent.keyboard("{Home}");
      await expect
        .element(screen.getByRole("tab", { name: "Chat overflow-0", exact: true }))
        .toHaveFocus();
      await userEvent.keyboard("{End}");
      await expect.element(lastTab).toHaveFocus();
      const close = screen.getByRole("button", { name: "Close tab Chat overflow-11" });
      await vi.waitFor(() => {
        const bounds = close.element().getBoundingClientRect();
        const viewport = strip.element().getBoundingClientRect();
        expect(bounds.left).toBeGreaterThanOrEqual(viewport.left);
        expect(bounds.right).toBeLessThanOrEqual(viewport.right + 1);
      });
    } finally {
      await cleanup();
    }
  });

  it("keeps one visible pane and a group switcher on narrow windows", async () => {
    const { screen, host, cleanup } = await setup();
    try {
      mocks.showMenu.mockResolvedValueOnce("split-right");
      await screen.getByRole("button", { name: "Main tab actions" }).click();
      await page.viewport(650, 850);
      await expect
        .element(screen.getByRole("group", { name: "Chat groups", exact: true }))
        .toBeVisible();
      expect(host.querySelectorAll(".desk-pane")).toHaveLength(1);
      await screen
        .getByRole("group", { name: "Chat groups", exact: true })
        .getByRole("button", { name: "Main", exact: true })
        .click();
      await expect
        .element(screen.getByRole("textbox", { name: "Existing composer two" }))
        .toBeVisible();
      expect(host.scrollWidth).toBeLessThanOrEqual(host.clientWidth + 1);
      expect(useDeskStore.getState().desk.focusedGroupId).toBeNull();
    } finally {
      await cleanup();
    }
  });
});
