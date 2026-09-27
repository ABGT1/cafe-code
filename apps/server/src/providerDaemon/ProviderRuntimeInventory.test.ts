import { assert, describe, it } from "@effect/vitest";
import type { ProviderDaemonHealth } from "@cafecode/contracts";
import { windowsSupervisorOwnershipMetadata } from "./ProviderRuntimeInventory.ts";

describe("Windows upstream supervisor identity propagation", () => {
  const legacyHealth: ProviderDaemonHealth = {
    ok: true,
    mode: "provider-supervisor",
    pid: 27,
    ppid: 1,
    version: "0.0.0-test",
    startedAt: "2026-09-27T00:00:00.000Z",
    activeSessionCount: 0,
    configuredInstanceCount: 0,
    eventCursor: 0,
  };
  const identity = { pid: 27, creationTime100ns: "134348901321234567" };
  const generation = "9a90b48d-868f-4614-ae9c-66d50293d52b";

  it("carries the supervisor's own authenticated generation and identity on Windows", () => {
    assert.deepEqual(
      windowsSupervisorOwnershipMetadata(
        {
          ...legacyHealth,
          windowsProcessIdentity: identity,
          windowsOwnershipId: generation,
        },
        "win32",
      ),
      { windowsProcessIdentity: identity, windowsOwnershipId: generation },
    );
  });

  it("does not invent legacy authority or change POSIX health payloads", () => {
    assert.deepEqual(windowsSupervisorOwnershipMetadata(legacyHealth, "win32"), {});
    for (const platform of ["darwin", "linux"] as const) {
      assert.deepEqual(
        windowsSupervisorOwnershipMetadata(
          {
            ...legacyHealth,
            windowsProcessIdentity: identity,
            windowsOwnershipId: generation,
          },
          platform,
        ),
        {},
      );
    }
  });
});
