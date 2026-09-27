import assert from "node:assert/strict";

import { describe, it } from "vitest";

import { assertSandboxedPreloadSource } from "./assert-sandboxed-preloads.mjs";

describe("sandboxed desktop preload bundle", () => {
  it("accepts Electron's supported sandbox preload modules", () => {
    assert.doesNotThrow(() =>
      assertSandboxedPreloadSource('const { contextBridge } = require("electron");', "preload.cjs"),
    );
  });

  it("rejects a shared relative chunk emitted by a multi-entry build", () => {
    assert.throws(
      () =>
        assertSandboxedPreloadSource(
          'const channels = require("./channels-BLatOA1z.cjs");',
          "preload.cjs",
        ),
      /unavailable to Electron's sandboxed preload/u,
    );
  });

  it("rejects dynamic or non-literal imports that cannot run in the sandbox", () => {
    assert.throws(
      () => assertSandboxedPreloadSource("const channels = require(path);", "preload.cjs"),
      /unavailable to Electron's sandboxed preload/u,
    );
    assert.throws(
      () => assertSandboxedPreloadSource('void import("./channels.cjs");', "preload.cjs"),
      /dynamic import unavailable/u,
    );
  });
});
