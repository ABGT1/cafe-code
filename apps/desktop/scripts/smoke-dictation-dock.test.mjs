import { describe, expect, it } from "vitest";
import { dockSmokeWorkspaceOptions, parseDockSmokeArguments } from "./smoke-dictation-dock.mjs";

describe("isolated native Dock smoke admission", () => {
  it("requires explicit opt-in even for the legacy negative control", () => {
    expect(() => parseDockSmokeArguments([])).toThrow("explicit_opt_in_required");
    expect(() => parseDockSmokeArguments(["--legacy"])).toThrow("explicit_opt_in_required");
    expect(parseDockSmokeArguments(["--run-native-test"])).toEqual({ legacy: false });
    expect(parseDockSmokeArguments(["--run-native-test", "--legacy"])).toEqual({ legacy: true });
  });

  it("rejects arbitrary targets, profiles, positionals, and duplicate options", () => {
    for (const extra of [
      ["--url", "https://example.test"],
      ["--user-data", "/unused"],
      ["document"],
      ["--legacy=true"],
      ["--legacy", "--legacy"],
      ["--run-native-test"],
    ]) {
      expect(() => parseDockSmokeArguments(["--run-native-test", ...extra])).toThrow();
    }
  });

  it("preserves fullscreen collection while changing only process transformation", () => {
    expect(dockSmokeWorkspaceOptions(false)).toEqual({
      visibleOnFullScreen: true,
      skipTransformProcessType: true,
    });
    expect(dockSmokeWorkspaceOptions(true)).toEqual({ visibleOnFullScreen: true });
  });
});
