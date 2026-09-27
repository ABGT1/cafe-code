import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import type * as Electron from "electron";
import { beforeEach, vi } from "vitest";

const { appFocusMock, getAllWindowsMock, getFocusedWindowMock } = vi.hoisted(() => ({
  appFocusMock: vi.fn(),
  getAllWindowsMock: vi.fn(),
  getFocusedWindowMock: vi.fn(),
}));

vi.mock("electron", () => ({
  app: {
    focus: appFocusMock,
  },
  BrowserWindow: {
    getAllWindows: getAllWindowsMock,
    getFocusedWindow: getFocusedWindowMock,
  },
}));

import * as ElectronWindow from "./ElectronWindow.ts";

function makeBrowserWindow(input: { readonly destroyed: boolean }) {
  return {
    isDestroyed: vi.fn(() => input.destroyed),
    webContents: { send: vi.fn() },
  } as unknown as Electron.BrowserWindow;
}

describe("ElectronWindow", () => {
  beforeEach(() => {
    appFocusMock.mockReset();
    getAllWindowsMock.mockReset();
    getFocusedWindowMock.mockReset();
  });

  it.effect("skips windows destroyed before appearance sync runs", () =>
    Effect.gen(function* () {
      const liveWindow = makeBrowserWindow({ destroyed: false });
      const destroyedWindow = makeBrowserWindow({ destroyed: true });
      getAllWindowsMock.mockReturnValue([destroyedWindow, liveWindow]);

      const syncedWindows: Electron.BrowserWindow[] = [];
      const electronWindow = yield* ElectronWindow.ElectronWindow;
      yield* electronWindow.syncAllAppearance((window) =>
        Effect.sync(() => {
          syncedWindows.push(window);
        }),
      );

      assert.deepEqual(syncedWindows, [liveWindow]);
    }).pipe(Effect.provide(ElectronWindow.layer)),
  );

  it.effect("excludes the dictation panel from main-window fallback and broadcast", () =>
    Effect.gen(function* () {
      const panel = makeBrowserWindow({ destroyed: false });
      const main = makeBrowserWindow({ destroyed: false });
      ElectronWindow.markAuxiliaryWindow(panel);
      getAllWindowsMock.mockReturnValue([panel, main]);
      getFocusedWindowMock.mockReturnValue(panel);

      const electronWindow = yield* ElectronWindow.ElectronWindow;
      const fallback = yield* electronWindow.currentMainOrFirst;
      const focused = yield* electronWindow.focusedMainOrFirst;
      assert.isTrue(fallback._tag === "Some" && fallback.value === main);
      assert.isTrue(focused._tag === "Some" && focused.value === main);

      const synced: Electron.BrowserWindow[] = [];
      yield* electronWindow.syncAllAppearance((window) =>
        Effect.sync(() => {
          synced.push(window);
        }),
      );
      assert.deepEqual(synced, [main]);

      yield* electronWindow.sendAll("main-only", 42);
      assert.deepEqual(vi.mocked(main.webContents.send).mock.calls, [["main-only", 42]]);
      assert.equal(vi.mocked(panel.webContents.send).mock.calls.length, 0);

      getAllWindowsMock.mockReturnValue([panel]);
      const withoutMain = yield* electronWindow.currentMainOrFirst;
      assert.equal(withoutMain._tag, "None");
    }).pipe(Effect.provide(ElectronWindow.layer)),
  );
});
