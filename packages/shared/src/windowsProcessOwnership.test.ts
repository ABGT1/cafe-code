// @effect-diagnostics nodeBuiltinImport:off
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import {
  captureWindowsProcessIdentity,
  isWindowsProcessIdentity,
  observeWindowsProcess,
  openWindowsOwnershipSession,
  terminateWindowsProcess,
  windowsOwnershipCredentialPath,
  WindowsOwnershipError,
  type WindowsOwnershipDependencies,
} from "./windowsProcessOwnership.ts";
import { WINDOWS_PROCESS_OWNERSHIP_SCRIPT } from "./windowsProcessOwnershipScript.ts";

const identity = { pid: 27424, creationTime100ns: "134030277320000001" };
const generation = "d71cfa92-97f4-4db2-bc90-66ad7641cfdd";
const revision = "b".repeat(64);
const sessionInput = {
  markerPath: "C:\\CafeFixture\\provider-daemon.json",
  legacyCredentialPath: "C:\\CafeFixture\\provider-daemon-token.bin",
  role: "daemon" as const,
};
type Request = Record<string, unknown> & { id: number; op: string };

/** Private pipe fixture: no Windows process, provider binary or user profile. */
function fixture(
  handle: (request: Request, reply: (result: unknown) => void, raw: (line: string) => void) => void,
  options: { readonly automaticReady?: boolean } = {},
) {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const requests: Request[] = [];
  let source: string | undefined;
  const events = new EventEmitter();
  const raw = (line: string) => {
    stdout.write(`${line}\n`);
  };
  const stdin = new Writable({
    write(chunk, _encoding, done) {
      const line = String(chunk).trimEnd();
      if (source === undefined) {
        source = Buffer.from(line, "base64").toString("utf8");
        if (options.automaticReady !== false)
          queueMicrotask(() => {
            for (const phase of ["bootstrap", "source", "ready"])
              raw(JSON.stringify({ id: 0, ok: true, phase }));
          });
      } else {
        const request = JSON.parse(line) as Request;
        requests.push(request);
        queueMicrotask(() =>
          handle(
            request,
            (result) => raw(JSON.stringify({ id: request.id, ok: true, result })),
            raw,
          ),
        );
      }
      done();
    },
  });
  const kill = vi.fn(() => {
    queueMicrotask(() => events.emit("exit", 0));
    return true;
  });
  const child = Object.assign(events, {
    stdin,
    stdout,
    stderr,
    kill,
  }) as unknown as ChildProcessWithoutNullStreams;
  const spawn = vi.fn(() => child);
  const dependencies: WindowsOwnershipDependencies = {
    platform: "win32",
    environment: {
      SystemRoot: "C:\\Windows",
      TEMP: "C:\\Temp",
      OPENAI_API_KEY: "do-not-inherit",
      NODE_OPTIONS: "do-not-inherit",
      PATH: "C:\\untrusted",
    },
    spawn,
    operationTimeoutMs: 100,
    sessionTimeoutMs: 2_000,
  };
  return { dependencies, spawn, requests, raw, kill, events, stderr, source: () => source };
}

describe("Windows process ownership protocol", () => {
  it.each(["darwin", "linux"] as const)("never starts a helper on %s", async (platform) => {
    const fake = fixture(() => undefined);
    expect(
      await captureWindowsProcessIdentity(identity.pid, { ...fake.dependencies, platform }),
    ).toEqual({ status: "unknown", reason: "unsupported-platform" });
    await expect(
      openWindowsOwnershipSession(sessionInput, { ...fake.dependencies, platform }),
    ).rejects.toMatchObject({ reason: "unsupported-platform" });
    expect(fake.spawn).not.toHaveBeenCalled();
  });

  it("uses an exact system executable, fixed short argv and a private stdin script", async () => {
    const fake = fixture((_request, reply) => reply({ status: "present", identity }));
    expect(await captureWindowsProcessIdentity(identity.pid, fake.dependencies)).toEqual({
      status: "present",
      identity,
    });
    const [executable, args, options] = fake.spawn.mock.calls[0] as unknown as [
      string,
      string[],
      Record<string, unknown>,
    ];
    expect(executable).toBe("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
    expect(args).toContain("-NoProfile");
    expect(args).toContain("-NonInteractive");
    expect(args.join(" ")).not.toContain("ExecutionPolicy");
    expect(args.join(" ").length).toBeLessThan(2_048);
    const bootstrap = Buffer.from(args.at(-1)!, "base64").toString("utf16le");
    expect(bootstrap.indexOf("InputEncoding")).toBeLessThan(
      bootstrap.indexOf("[Console]::In.ReadLine"),
    );
    expect(fake.source()).not.toContain("[Console]::InputEncoding");
    expect(options).toMatchObject({
      shell: false,
      windowsHide: true,
      env: { SystemRoot: "C:\\Windows", PATH: "C:\\Windows\\System32" },
    });
    expect(JSON.stringify(options)).not.toContain("do-not-inherit");
    expect(fake.source()).toBe(WINDOWS_PROCESS_OWNERSHIP_SCRIPT);
    expect(fake.requests).toEqual([{ id: 1, op: "capture", pid: identity.pid }]);
    expect(fake.kill).toHaveBeenCalledOnce();
  });

  it.each(["same-process", "different-process", "exited", "unknown"] as const)(
    "preserves explicit %s observation",
    async (status) => {
      const fake = fixture((_request, reply) => reply({ status }));
      expect(await observeWindowsProcess(identity, fake.dependencies)).toEqual({ status });
    },
  );

  it("waits for compiled native readiness before writing the first JSON request", async () => {
    const fake = fixture((_request, reply) => reply({ status: "present", identity }), {
      automaticReady: false,
    });
    const onStartupPhase = vi.fn();
    const operation = captureWindowsProcessIdentity(identity.pid, {
      ...fake.dependencies,
      onStartupPhase,
    });
    await Promise.resolve();
    expect(fake.requests).toHaveLength(0);
    fake.raw('{"id":0,"ok":true,"phase":"bootstrap"}');
    fake.raw('{"id":0,"ok":true,"phase":"source"}');
    expect(fake.requests).toHaveLength(0);
    fake.raw('{"id":0,"ok":true,"phase":"ready"}');
    expect(await operation).toEqual({ status: "present", identity });
    expect(fake.requests).toHaveLength(1);
    expect(onStartupPhase.mock.calls).toEqual([["bootstrap"], ["source"], ["ready"]]);
  });

  it("fails closed on a missing or out-of-order native readiness handshake", async () => {
    const stalled = fixture(() => undefined, { automaticReady: false });
    expect(
      await captureWindowsProcessIdentity(identity.pid, {
        ...stalled.dependencies,
        operationTimeoutMs: 5,
      }),
    ).toEqual({ status: "unknown", reason: "helper-timeout" });
    expect(stalled.requests).toHaveLength(0);
    const unordered = fixture(() => undefined, { automaticReady: false });
    const operation = captureWindowsProcessIdentity(identity.pid, unordered.dependencies);
    await Promise.resolve();
    unordered.raw('{"id":0,"ok":true,"phase":"ready"}');
    expect(await operation).toEqual({ status: "unknown", reason: "invalid-response" });
    expect(unordered.requests).toHaveLength(0);
  });

  it("does not reinterpret denied native observation as exit", async () => {
    const fake = fixture((_request, reply) =>
      reply({ status: "unknown", reason: "access-denied" }),
    );
    expect(await observeWindowsProcess(identity, fake.dependencies)).toEqual({
      status: "unknown",
      reason: "access-denied",
    });
  });

  it("never adds a target PID kill fallback after inconclusive termination", async () => {
    const fake = fixture((_request, reply) =>
      reply({ status: "unknown", reason: "termination-unconfirmed" }),
    );
    expect(await terminateWindowsProcess(identity, fake.dependencies)).toEqual({
      status: "unknown",
      reason: "termination-unconfirmed",
    });
    expect(fake.requests).toEqual([{ id: 1, op: "terminate", identity }]);
    expect(fake.spawn).toHaveBeenCalledOnce();
  });

  it.each([
    { pid: 0, creationTime100ns: "1" },
    { pid: 1.5, creationTime100ns: "1" },
    { pid: 4294967296, creationTime100ns: "1" },
    { pid: 1, creationTime100ns: "01" },
    { pid: 1, creationTime100ns: "0" },
    { pid: 1, creationTime100ns: "+1" },
    { pid: 1, creationTime100ns: "18446744073709551616" },
    { pid: 1, creationTime100ns: 123 },
  ])("rejects malformed/lossy process authority %#", async (invalid) => {
    expect(isWindowsProcessIdentity(invalid)).toBe(false);
    const fake = fixture(() => undefined);
    expect(
      await observeWindowsProcess(invalid as typeof identity, fake.dependencies),
    ).toMatchObject({ status: "unknown", reason: "invalid-request" });
    expect(fake.requests).toHaveLength(0);
  });

  it("round-trips uint64 FILETIME without numeric conversion", async () => {
    const maximum = { pid: 0xffff_ffff, creationTime100ns: "18446744073709551615" };
    const fake = fixture((_request, reply) => reply({ status: "present", identity: maximum }));
    expect(isWindowsProcessIdentity(maximum)).toBe(true);
    expect(await captureWindowsProcessIdentity(maximum.pid, fake.dependencies)).toEqual({
      status: "present",
      identity: maximum,
    });
  });

  it("rejects a captured response for a different PID", async () => {
    const fake = fixture((_request, reply) =>
      reply({ status: "present", identity: { ...identity, pid: 99 } }),
    );
    expect(await captureWindowsProcessIdentity(identity.pid, fake.dependencies)).toEqual({
      status: "unknown",
      reason: "invalid-response",
    });
  });

  it.each([
    "not-json secret-token",
    JSON.stringify({ id: 1, ok: false, reason: "private secret-token" }),
    JSON.stringify({ id: 123, ok: true, result: { status: "exited" } }),
  ])("sanitizes malformed/out-of-order helper output %#", async (response) => {
    const fake = fixture((_request, _reply, raw) => raw(response));
    const result = await observeWindowsProcess(identity, fake.dependencies);
    expect(result).toEqual({ status: "unknown", reason: "invalid-response" });
    expect(JSON.stringify(result)).not.toContain("secret-token");
  });

  it("bounds response bytes and stalled helpers", async () => {
    const huge = fixture((_request, _reply, raw) => raw("X".repeat(8_193)));
    expect(await observeWindowsProcess(identity, huge.dependencies)).toEqual({
      status: "unknown",
      reason: "invalid-response",
    });
    const stalled = fixture(() => undefined);
    expect(
      await observeWindowsProcess(identity, { ...stalled.dependencies, operationTimeoutMs: 5 }),
    ).toEqual({ status: "unknown", reason: "helper-timeout" });
    expect(stalled.kill).toHaveBeenCalledOnce();
  });

  it("turns helper death into uncertainty without replay", async () => {
    const fake = fixture(() => fake.events.emit("exit", 1));
    expect(await observeWindowsProcess(identity, fake.dependencies)).toEqual({
      status: "unknown",
      reason: "helper-exited",
    });
    expect(fake.requests).toHaveLength(1);
  });

  it("keeps generation credentials confined to one derived sibling", () => {
    expect(windowsOwnershipCredentialPath(sessionInput.legacyCredentialPath, generation)).toBe(
      `${sessionInput.legacyCredentialPath}.${generation}`,
    );
    expect(() =>
      windowsOwnershipCredentialPath(sessionInput.legacyCredentialPath, "..\\new-owner"),
    ).toThrow(WindowsOwnershipError);
  });

  it("serializes helper-owned mutation requests under a single live guard", async () => {
    const fake = fixture((request, reply) => {
      if (request.op === "open") reply({ opened: true });
      else if (request.op === "read") reply({ markerJson: null, revision: null });
      else if (request.op === "publish") reply({ revision });
      else if (request.op === "retire") reply({ retired: true });
      else reply({ closed: true });
    });
    const session = await openWindowsOwnershipSession(sessionInput, fake.dependencies);
    expect(await session.read()).toEqual({ markerJson: null, revision: null });
    expect(
      await session.publish({
        expectedRevision: null,
        markerJson: "{}",
        credentialBase64: "c2VjcmV0",
      }),
    ).toBe(revision);
    await session.retire(revision);
    await session.close();
    expect(fake.requests.map((request) => request.op)).toEqual([
      "open",
      "read",
      "publish",
      "retire",
      "close",
    ]);
    expect(fake.spawn).toHaveBeenCalledOnce();
    await expect(session.read()).rejects.toMatchObject({ reason: "session-closed" });
  });

  it("preserves unknown/changed ownership failures, including lost mutation acknowledgements", async () => {
    const fake = fixture((request, reply, raw) => {
      if (request.op === "open") reply({ opened: true });
      else if (request.op === "publish")
        raw(JSON.stringify({ id: request.id, ok: false, reason: "ownership-changed" }));
      else if (request.op === "retire") fake.events.emit("exit", 1);
      else reply({ closed: true });
    });
    const session = await openWindowsOwnershipSession(sessionInput, fake.dependencies);
    await expect(
      session.publish({ expectedRevision: revision, markerJson: "{}" }),
    ).rejects.toMatchObject({ reason: "ownership-changed" });
    await expect(session.retire(revision)).rejects.toMatchObject({ reason: "helper-exited" });
    await expect(session.read()).rejects.toMatchObject({ reason: "session-closed" });
    expect(fake.requests.map((request) => request.op)).toEqual(["open", "publish", "retire"]);
  });

  it("rejects inconsistent snapshot and credential payloads", async () => {
    const fake = fixture((request, reply) =>
      reply(
        request.op === "open"
          ? { opened: true }
          : request.op === "close"
            ? { closed: true }
            : { markerJson: null, revision, credentialBase64: "secret-token" },
      ),
    );
    const session = await openWindowsOwnershipSession(sessionInput, fake.dependencies);
    await expect(session.read()).rejects.toMatchObject({ reason: "invalid-response" });
    await expect(
      session.publish({ expectedRevision: null, markerJson: "{}", credentialBase64: "!!!" }),
    ).rejects.toMatchObject({ reason: "invalid-request" });
    await session.close();
  });

  it("expires idle guard sessions and never sends a queued mutation after expiry", async () => {
    const fake = fixture((request, reply) => {
      if (request.op === "open") reply({ opened: true });
    });
    const session = await openWindowsOwnershipSession(sessionInput, {
      ...fake.dependencies,
      sessionTimeoutMs: 5,
    });
    const blockedRead = session.read();
    const queuedPublish = session.publish({ expectedRevision: null, markerJson: "{}" });
    await expect(blockedRead).rejects.toMatchObject({ reason: "helper-timeout" });
    await expect(queuedPublish).rejects.toMatchObject({ reason: "session-closed" });
    expect(fake.requests.map((request) => request.op)).toEqual(["open", "read"]);
    expect(fake.kill).toHaveBeenCalledOnce();
  });

  it("sanitizes helper startup failures without exposing exception text", async () => {
    const fake = fixture((_request, _reply, raw) => {
      fake.stderr.write("private-token C:\\private\\credential");
      raw(JSON.stringify({ id: 0, ok: false, reason: "helper-unavailable" }));
    });
    await expect(openWindowsOwnershipSession(sessionInput, fake.dependencies)).rejects.toEqual(
      new WindowsOwnershipError("helper-unavailable"),
    );
    expect(fake.kill).toHaveBeenCalledOnce();
  });

  it("does not resolve session close until the helper actually exits after its ACK", async () => {
    const fake = fixture((request, reply) => {
      reply(request.op === "open" ? { opened: true } : { closed: true });
    });
    fake.kill.mockImplementation(() => true);
    const session = await openWindowsOwnershipSession(sessionInput, fake.dependencies);
    let closed = false;
    const closing = session.close().then(() => {
      closed = true;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(fake.requests.map((request) => request.op)).toEqual(["open", "close"]);
    expect(closed).toBe(false);
    // This event, not the preceding ACK, releases authority to open another
    // role's guard. Tests simulate the native finalizer still running until now.
    fake.events.emit("exit", 0);
    await closing;
    expect(closed).toBe(true);
  });

  it("fails closed when a helper acknowledges close but exit remains unconfirmed", async () => {
    const fake = fixture((request, reply) => {
      reply(request.op === "open" ? { opened: true } : { closed: true });
    });
    fake.kill.mockImplementation(() => true);
    const session = await openWindowsOwnershipSession(sessionInput, {
      ...fake.dependencies,
      helperExitTimeoutMs: 5,
    });
    await expect(session.close()).rejects.toMatchObject({ reason: "helper-exit-unconfirmed" });
    expect(fake.requests.map((request) => request.op)).toEqual(["open", "close"]);
    fake.events.emit("exit", 0);
  });

  it("accepts confirmed helper exit when the exit event overtakes the close ACK", async () => {
    const fake = fixture((request, reply) => {
      if (request.op === "open") reply({ opened: true });
      else fake.events.emit("exit", 0);
    });
    const session = await openWindowsOwnershipSession(sessionInput, fake.dependencies);
    await expect(session.close()).resolves.toBeUndefined();
    expect(fake.requests.map((request) => request.op)).toEqual(["open", "close"]);
  });

  it("does not promote a malformed close response even after confirmed exit", async () => {
    const fake = fixture((request, reply, raw) => {
      if (request.op === "open") reply({ opened: true });
      else raw("invalid private native response");
    });
    const session = await openWindowsOwnershipSession(sessionInput, fake.dependencies);
    await expect(session.close()).rejects.toMatchObject({ reason: "invalid-response" });
    expect(fake.requests.map((request) => request.op)).toEqual(["open", "close"]);
  });
});
