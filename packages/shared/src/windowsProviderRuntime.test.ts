// @effect-diagnostics nodeBuiltinImport:off
import { describe, expect, it, vi } from "vitest";
import type { ProviderDaemonHealth, ProviderDaemonMarker } from "@cafecode/contracts";
import type { WindowsOwnershipSession, WindowsProcessIdentity } from "./windowsProcessOwnership.ts";
import {
  createWindowsProviderRuntime,
  WindowsProviderRuntimeError,
  type WindowsProviderRuntimeOptions,
} from "./windowsProviderRuntime.ts";

const ownershipId = "be5b2b29-72ef-4d31-9571-50856776e18b";
const identity: WindowsProcessIdentity = { pid: 101, creationTime100ns: "134032074530123456" };
const secondIdentity: WindowsProcessIdentity = {
  pid: 101,
  creationTime100ns: "134042074530123456",
};
const token = "synthetic-private-token-not-a-real-account-token";
const credential = Buffer.from(token).toString("base64");
const socketPath = "\\\\.\\pipe\\cafe-runtime-test";
const marker = (overrides: Partial<ProviderDaemonMarker> = {}): ProviderDaemonMarker => ({
  version: 2,
  mode: "provider-daemon",
  pid: identity.pid,
  ppid: 42,
  protocolVersion: 1,
  transport: "ipc",
  httpBaseUrl: "http://provider-daemon.local",
  socketPath,
  credentialPath: `C:\\fixture\\provider-daemon-token.bin.${ownershipId}`,
  credentialEncrypted: false,
  appVersion: "1.0.0",
  runtimeBuildId: "build-one",
  createdAt: "2026-09-27T00:00:00.000Z",
  updatedAt: "2026-09-27T00:00:00.000Z",
  windowsProcessIdentity: identity,
  windowsOwnershipId: ownershipId,
  windowsOwnershipState: "committed",
  ...overrides,
});

function fixture(initial: ProviderDaemonMarker | null = marker()) {
  let record = initial;
  let revision = initial ? "revision-one" : null;
  let storedCredential: string | undefined = initial ? credential : undefined;
  let clock = 0;
  let counter = 0;
  let childExited = false;
  let unavailable = false;
  let captureUnknown = false;
  let observationUnknown = false;
  let terminationUnknown = false;
  let readError = false;
  let leaseError = false;
  let publishFailureAt = 0;
  let retireFailure = false;
  let response: ProviderDaemonHealth | undefined;
  const processes = new Map<number, WindowsProcessIdentity>([
    [identity.pid, identity],
    [process.pid, { pid: process.pid, creationTime100ns: "134000000000000000" }],
  ]);
  const compare = (expected: WindowsProcessIdentity) => {
    if (observationUnknown) return { status: "unknown" as const };
    const actual = processes.get(expected.pid);
    return {
      status: !actual
        ? ("exited" as const)
        : actual.creationTime100ns === expected.creationTime100ns
          ? ("same-process" as const)
          : ("different-process" as const),
    };
  };
  const health = (): ProviderDaemonHealth => {
    if (response) return response;
    if (!record || unavailable) throw new Error("PRIVATE endpoint output");
    const processIdentity = processes.get(record.pid);
    if (
      !processIdentity ||
      (record.windowsProcessIdentity &&
        processIdentity.creationTime100ns !== record.windowsProcessIdentity.creationTime100ns)
    ) {
      throw new Error("PRIVATE endpoint unavailable");
    }
    return {
      ok: true,
      mode: record.mode ?? "provider-daemon",
      pid: record.pid,
      ppid: 42,
      protocolVersion: 1,
      version: "1.0.0",
      runtimeBuildId: "build-one",
      startedAt: "2026-09-27T00:00:00.000Z",
      activeSessionCount: 0,
      configuredInstanceCount: 0,
      eventCursor: 0,
      transport: "ipc",
      windowsProcessIdentity: processIdentity,
      ...(record.windowsOwnershipId === undefined
        ? {}
        : { windowsOwnershipId: record.windowsOwnershipId }),
    };
  };
  const session: WindowsOwnershipSession = {
    read: vi.fn(async () => {
      if (readError) throw new Error("PRIVATE C:\\profile\\marker");
      return {
        markerJson: record ? JSON.stringify(record) : null,
        revision,
        ...(storedCredential === undefined ? {} : { credentialBase64: storedCredential }),
      };
    }),
    publish: vi.fn(async (input) => {
      if (input.expectedRevision !== revision) throw new Error("ownership changed");
      record = JSON.parse(input.markerJson) as ProviderDaemonMarker;
      revision = `revision-${++counter}`;
      if (input.credentialBase64 !== undefined) storedCredential = input.credentialBase64;
      if (counter === publishFailureAt) throw new Error("PRIVATE committed reply lost");
      return revision;
    }),
    retire: vi.fn(async (expectedRevision) => {
      if (expectedRevision !== revision) throw new Error("ownership changed");
      record = null;
      revision = null;
      storedCredential = undefined;
      if (retireFailure) throw new Error("PRIVATE retired reply lost");
    }),
    capture: vi.fn(async (pid) => {
      if (captureUnknown) return { status: "unknown" as const };
      const actual = processes.get(pid);
      return actual
        ? { status: "present" as const, identity: actual }
        : { status: "exited" as const };
    }),
    observe: vi.fn(async (expected) => compare(expected)),
    terminate: vi.fn(async (expected) => {
      if (terminationUnknown) return { status: "unknown" as const };
      const observed = compare(expected);
      if (observed.status === "same-process") {
        processes.delete(expected.pid);
        return { status: "exited" as const };
      }
      return { status: observed.status };
    }),
    close: vi.fn(async () => {}),
  };
  const spawn = vi.fn(async () => {
    processes.set(201, { pid: 201, creationTime100ns: "134050000000000000" });
    return { pid: 201, hasExited: () => childExited };
  });
  const options: WindowsProviderRuntimeOptions = {
    role: "provider-daemon",
    markerPath: "C:\\fixture\\provider-daemon.json",
    legacyCredentialPath: "C:\\fixture\\provider-daemon-token.bin",
    socketPath,
    appVersion: "1.0.0",
    protocolVersion: 1,
    runtimeBuildId: "build-one",
    bootstrap: { cafeCodeHome: "C:\\fixture" },
    encodeCredential: async (value) => ({
      base64: Buffer.from(value).toString("base64"),
      encrypted: false,
    }),
    decodeCredential: async (value) => Buffer.from(value, "base64").toString(),
    spawn,
    openSession: vi.fn(async () => session),
    fetchHealth: vi.fn(async () => health()),
    issueLease: vi.fn(async () => {
      if (leaseError) throw new Error("PRIVATE lease output");
      return {
        leaseId: "synthetic-lease-identifier",
        token: `${token}-lease`,
        capabilities: ["health", "events", "rpc", "lease"] as const,
        issuedAt: "2026-09-27T00:00:00.000Z",
      };
    }),
    now: () => clock,
    sleep: async (milliseconds) => {
      clock += milliseconds;
    },
    readinessTimeoutMs: 5,
  };
  return {
    options,
    session,
    spawn,
    processes,
    runtime: createWindowsProviderRuntime(options),
    get record() {
      return record;
    },
    get revision() {
      return revision;
    },
    setRecord(next: ProviderDaemonMarker | null) {
      record = next;
      revision = next ? `external-${++counter}` : null;
    },
    setCredential(value?: string) {
      storedCredential = value;
    },
    setUnavailable(value: boolean) {
      unavailable = value;
    },
    setResponse(value?: ProviderDaemonHealth) {
      response = value;
    },
    setChildExited(value: boolean) {
      childExited = value;
    },
    setCaptureUnknown(value: boolean) {
      captureUnknown = value;
    },
    setObservationUnknown(value: boolean) {
      observationUnknown = value;
    },
    setTerminationUnknown(value: boolean) {
      terminationUnknown = value;
    },
    setReadError(value: boolean) {
      readError = value;
    },
    setLeaseError(value: boolean) {
      leaseError = value;
    },
    setPublishFailureAt(value: number) {
      publishFailureAt = value;
    },
    setRetireFailure(value: boolean) {
      retireFailure = value;
    },
    health,
  };
}

describe("Windows provider runtime ownership lifecycle", () => {
  it("adopts a matching authenticated process and obtains a scoped lease", async () => {
    const f = fixture();
    const result = await f.runtime.ensure();
    expect(result.adopted).toBe(true);
    expect(result.endpoint.token).toBe(`${token}-lease`);
    expect(await f.runtime.observe()).toEqual({ status: "same-process", ownershipId });
    expect(f.spawn).not.toHaveBeenCalled();
    expect(f.session.terminate).not.toHaveBeenCalled();
  });

  it("retires a proven reused PID without signalling its unrelated occupant", async () => {
    const f = fixture();
    f.processes.set(identity.pid, secondIdentity);
    const result = await f.runtime.ensure();
    expect(result.adopted).toBe(false);
    expect(result.marker.pid).toBe(201);
    expect(f.processes.get(identity.pid)).toEqual(secondIdentity);
    expect(f.session.terminate).not.toHaveBeenCalled();
    expect(f.session.retire).toHaveBeenCalledTimes(1);
  });

  it("confirmed process exit allows a fresh bound generation", async () => {
    const f = fixture();
    f.processes.delete(identity.pid);
    const result = await f.runtime.ensure();
    expect(result.marker.windowsOwnershipState).toBe("committed");
    expect(result.marker.windowsProcessIdentity).toEqual(f.processes.get(201));
    expect(f.spawn).toHaveBeenCalledTimes(1);
    expect(f.session.terminate).not.toHaveBeenCalled();
  });

  it.each(["credential", "health", "lease", "identity", "read"] as const)(
    "preserves ownership after inconclusive %s observation",
    async (phase) => {
      const f = fixture();
      if (phase === "credential") f.setCredential();
      if (phase === "health") f.setUnavailable(true);
      if (phase === "lease") f.setLeaseError(true);
      if (phase === "identity") f.setObservationUnknown(true);
      if (phase === "read") f.setReadError(true);
      await expect(f.runtime.ensure()).rejects.toBeInstanceOf(WindowsProviderRuntimeError);
      expect(f.record).toEqual(marker());
      expect(f.spawn).not.toHaveBeenCalled();
      expect(f.session.retire).not.toHaveBeenCalled();
      expect(f.session.terminate).not.toHaveBeenCalled();
    },
  );

  it("rejects authenticated contradictory endpoint evidence during stale retirement", async () => {
    const f = fixture();
    const health = f.health();
    f.processes.set(identity.pid, secondIdentity);
    f.setResponse(health);
    await expect(f.runtime.ensure()).rejects.toMatchObject({ reason: "endpoint-conflict" });
    expect(f.session.retire).not.toHaveBeenCalled();
    expect(f.spawn).not.toHaveBeenCalled();
  });

  it("does not grant ownership when a new-generation endpoint omits its OS identity", async () => {
    const f = fixture();
    const { windowsProcessIdentity: _identity, ...health } = f.health();
    f.setResponse(health);
    await expect(f.runtime.ensure()).rejects.toMatchObject({ reason: "endpoint-conflict" });
    expect(f.session.terminate).not.toHaveBeenCalled();
  });

  it("migrates an authenticated legacy owner by exact OS identity without changing credentials", async () => {
    const {
      windowsOwnershipId: _id,
      windowsOwnershipState: _state,
      windowsProcessIdentity: _identity,
      ...legacy
    } = marker();
    const f = fixture(legacy);
    const result = await f.runtime.ensure();
    expect(result.marker.windowsProcessIdentity).toEqual(identity);
    expect(result.marker.windowsOwnershipId).toBeUndefined();
    expect(result.ownershipId).toBe(f.revision);
    expect(result.marker.credentialPath).toBe(legacy.credentialPath);
    expect(f.spawn).not.toHaveBeenCalled();
    expect(f.session.publish).toHaveBeenCalledWith(
      expect.not.objectContaining({ credentialBase64: expect.anything() }),
    );
  });

  it("does not infer a legacy owner from timestamps or a currently live PID", async () => {
    const {
      windowsOwnershipId: _id,
      windowsOwnershipState: _state,
      windowsProcessIdentity: _identity,
      ...legacy
    } = marker({ createdAt: "2020-01-01T00:00:00.000Z" });
    const f = fixture(legacy);
    f.setUnavailable(true);
    await expect(f.runtime.ensure()).rejects.toMatchObject({ reason: "legacy-identity-unknown" });
    expect(f.session.publish).not.toHaveBeenCalled();
    expect(f.session.retire).not.toHaveBeenCalled();
  });

  it("preflights native identity support before creating any attempt or child", async () => {
    const f = fixture(null);
    f.setCaptureUnknown(true);
    await expect(f.runtime.ensure()).rejects.toMatchObject({ reason: "ownership-unavailable" });
    expect(f.session.publish).not.toHaveBeenCalled();
    expect(f.spawn).not.toHaveBeenCalled();
  });

  it("retains an uncertain prepared attempt instead of repeatedly spawning", async () => {
    const f = fixture(null);
    f.setUnavailable(true);
    await expect(f.runtime.ensure()).rejects.toMatchObject({
      reason: "prepared-attempt-uncertain",
    });
    expect(f.record?.windowsOwnershipState).toBe("prepared");
    await expect(f.runtime.ensure()).rejects.toMatchObject({
      reason: "prepared-attempt-uncertain",
    });
    expect(f.spawn).toHaveBeenCalledTimes(1);
    expect(f.session.terminate).not.toHaveBeenCalled();
  });

  it("a lost prepared publication reply does not spawn or blindly replay the mutation", async () => {
    const f = fixture(null);
    f.setPublishFailureAt(1);
    await expect(f.runtime.ensure()).rejects.toMatchObject({ reason: "mutation-uncertain" });
    expect(f.record?.pid).toBe(0);
    expect(f.spawn).not.toHaveBeenCalled();
    await expect(f.runtime.ensure()).rejects.toMatchObject({
      reason: "prepared-attempt-uncertain",
    });
    expect(f.session.publish).toHaveBeenCalledTimes(1);
  });

  it("recovers a pid-zero attempt only from matching authenticated generation and OS identity", async () => {
    const { windowsProcessIdentity: _identity, ...prepared } = marker({
      pid: 0,
      windowsOwnershipState: "prepared",
    });
    const f = fixture(prepared);
    f.setResponse({
      ok: true,
      mode: "provider-daemon",
      pid: identity.pid,
      ppid: 42,
      protocolVersion: 1,
      version: "1.0.0",
      runtimeBuildId: "build-one",
      startedAt: "2026-09-27T00:00:00.000Z",
      activeSessionCount: 0,
      configuredInstanceCount: 0,
      eventCursor: 0,
      windowsOwnershipId: ownershipId,
      windowsProcessIdentity: identity,
    });
    const result = await f.runtime.ensure();
    expect(result.marker.windowsOwnershipState).toBe("committed");
    expect(result.marker.pid).toBe(identity.pid);
    expect(f.spawn).not.toHaveBeenCalled();
    expect(f.session.capture).not.toHaveBeenCalledWith(0);
  });

  it("a lost committed reply re-observes the durable owner without another spawn", async () => {
    const f = fixture(null);
    f.setPublishFailureAt(3);
    await expect(f.runtime.ensure()).rejects.toMatchObject({ reason: "mutation-uncertain" });
    expect(f.record?.windowsOwnershipState).toBe("committed");
    expect((await f.runtime.ensure()).adopted).toBe(true);
    expect(f.spawn).toHaveBeenCalledTimes(1);
  });

  it("preserves a prepared identity when an authenticated endpoint contradicts its birth time", async () => {
    const f = fixture(marker({ windowsOwnershipState: "prepared" }));
    f.setResponse({ ...f.health(), windowsProcessIdentity: secondIdentity });
    f.setObservationUnknown(true);
    await expect(f.runtime.ensure()).rejects.toMatchObject({ reason: "endpoint-conflict" });
    expect(f.session.publish).not.toHaveBeenCalled();
    expect(f.session.retire).not.toHaveBeenCalled();
  });

  it("a failed lease retains the admitted generation for later safe adoption", async () => {
    const f = fixture(null);
    f.setLeaseError(true);
    await expect(f.runtime.ensure()).rejects.toMatchObject({ reason: "lease-unavailable" });
    expect(f.record?.windowsOwnershipState).toBe("committed");
    f.setLeaseError(false);
    await f.runtime.ensure();
    expect(f.spawn).toHaveBeenCalledTimes(1);
    expect(f.session.terminate).not.toHaveBeenCalled();
  });

  it("retires a failed actual child only after its direct-child exit event", async () => {
    const f = fixture(null);
    f.setChildExited(true);
    f.setUnavailable(true);
    await expect(f.runtime.ensure()).rejects.toMatchObject({ reason: "child-admission-uncertain" });
    expect(f.record).toBeNull();
    expect(f.session.terminate).not.toHaveBeenCalled();
  });

  it("rejects bootstrap-generation mismatch without terminating any process", async () => {
    const f = fixture(null);
    const other = fixture().health();
    f.setResponse(other);
    await expect(f.runtime.ensure()).rejects.toMatchObject({ reason: "child-admission-uncertain" });
    expect(f.record?.windowsOwnershipState).toBe("prepared");
    expect(f.session.terminate).not.toHaveBeenCalled();
  });

  it("stop never signals a PID reused after successful adoption", async () => {
    const f = fixture();
    const result = await f.runtime.ensure();
    f.processes.set(identity.pid, secondIdentity);
    await f.runtime.stop(result.ownershipId);
    expect(f.session.terminate).not.toHaveBeenCalled();
    expect(f.processes.get(identity.pid)).toEqual(secondIdentity);
  });

  it("termination refusal preserves the owner and prevents a competing recovery child", async () => {
    const f = fixture();
    const result = await f.runtime.ensure();
    f.setTerminationUnknown(true);
    await expect(f.runtime.recover(result.ownershipId)).rejects.toMatchObject({
      reason: "termination-uncertain",
    });
    expect(f.record).not.toBeNull();
    expect(f.session.retire).not.toHaveBeenCalled();
    expect(f.spawn).not.toHaveBeenCalled();
  });

  it("a replaced marker fences a stale watchdog before any mutation", async () => {
    const f = fixture();
    const result = await f.runtime.ensure();
    f.setRecord(marker({ windowsOwnershipId: "ee5b2b29-72ef-4d31-9571-50856776e18b" }));
    await expect(f.runtime.recover(result.ownershipId)).rejects.toMatchObject({
      reason: "ownership-changed",
    });
    expect(f.session.terminate).not.toHaveBeenCalled();
    expect(f.session.retire).not.toHaveBeenCalled();
  });

  it("a stale recovery returns an already accepted newer owner without replacing it", async () => {
    const f = fixture();
    const old = await f.runtime.ensure();
    f.setRecord(marker({ windowsOwnershipId: "ee5b2b29-72ef-4d31-9571-50856776e18b" }));
    const fresh = await f.runtime.ensure();
    const recovered = await f.runtime.recover(old.ownershipId);
    expect(recovered.ownershipId).toBe(fresh.ownershipId);
    expect(f.session.terminate).not.toHaveBeenCalled();
    expect(f.spawn).not.toHaveBeenCalled();
  });

  it("a lost retirement reply never falls through into spawning", async () => {
    const f = fixture();
    f.processes.delete(identity.pid);
    f.setRetireFailure(true);
    await expect(f.runtime.ensure()).rejects.toMatchObject({ reason: "mutation-uncertain" });
    expect(f.spawn).not.toHaveBeenCalled();
  });

  it("preserves separately configured supervisor ownership instead of killing a cached PID", async () => {
    const f = fixture();
    f.setResponse({
      ...f.health(),
      upstreamSupervisor: { configured: true, reachable: true, pid: 333 },
    });
    await f.runtime.ensure();
    await expect(f.runtime.stop()).rejects.toMatchObject({ reason: "upstream-ownership-unknown" });
    expect(f.session.terminate).not.toHaveBeenCalled();
  });

  it("closes guards and exposes no native errors or private material", async () => {
    const f = fixture();
    f.setReadError(true);
    try {
      await f.runtime.ensure();
      throw new Error("test must fail");
    } catch (error) {
      expect(error).toBeInstanceOf(WindowsProviderRuntimeError);
      expect(String(error)).not.toMatch(/PRIVATE|profile|synthetic-private/);
    }
    expect(f.session.close).toHaveBeenCalledTimes(1);
  });
});
