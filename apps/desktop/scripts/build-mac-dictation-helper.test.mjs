import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it } from "vitest";

import {
  ensureMacDictationHelper,
  sourceMacDictationHelperPath,
} from "./build-mac-dictation-helper.mjs";

const desktopDirectory = dirname(dirname(fileURLToPath(import.meta.url)));

describe("macOS dictation helper build", () => {
  it("resolves an architecture specific source executable", () => {
    assert.equal(
      sourceMacDictationHelperPath("arm64"),
      join(desktopDirectory, "native/build/arm64/mac-dictation-target"),
    );
    assert.equal(
      sourceMacDictationHelperPath("x64"),
      join(desktopDirectory, "native/build/x64/mac-dictation-target"),
    );
  });

  it("does not require the Apple compiler for other platforms", () => {
    assert.equal(ensureMacDictationHelper({ platform: "linux" }), null);
    assert.equal(ensureMacDictationHelper({ platform: "win32" }), null);
  });

  it("rejects an unsupported Mac release architecture before compiler invocation", () => {
    assert.throws(
      () => ensureMacDictationHelper({ platform: "darwin", architecture: "ppc" }),
      /Unsupported macOS dictation helper build target/,
    );
  });
});
