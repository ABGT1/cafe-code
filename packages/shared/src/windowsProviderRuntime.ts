// @effect-diagnostics nodeBuiltinImport:off
import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import type { SpawnOptions } from "node:child_process";
import * as Schema from "effect/Schema";
import {
  PROVIDER_DAEMON_HEALTH_PATH,
  PROVIDER_DAEMON_LEASES_PATH,
  ProviderDaemonHealth,
  ProviderDaemonLeaseResponse,
  ProviderDaemonMarker,
  type ProviderDaemonBootstrap,
  type ProviderDaemonClientConfig,
  type ProviderRuntimeProcessMode,
} from "@cafecode/contracts";
import { requestProviderDaemonJson } from "./providerDaemonHttp.ts";
import {
  openWindowsOwnershipSession,
  windowsOwnershipCredentialPath,
  type WindowsOwnershipSession,
  type WindowsOwnershipSnapshot,
  type WindowsProcessIdentity,
} from "./windowsProcessOwnership.ts";

/** Fixed diagnostic vocabulary; native output, credentials and paths never escape. */
export type WindowsProviderRuntimeFailure =
  | "ownership-unavailable"
  | "invalid-record"
  | "credential-unavailable"
  | "identity-unknown"
  | "legacy-identity-unknown"
  | "endpoint-unavailable"
  | "endpoint-conflict"
  | "lease-unavailable"
  | "ownership-changed"
  | "mutation-uncertain"
  | "prepared-attempt-uncertain"
  | "child-admission-uncertain"
  | "upstream-ownership-unknown"
  | "termination-uncertain";

export class WindowsProviderRuntimeError extends Error {
  readonly reason: WindowsProviderRuntimeFailure;
  constructor(reason: WindowsProviderRuntimeFailure) {
    super(
      reason === "legacy-identity-unknown"
        ? "Existing Windows runtime has no verified process identity. Its ownership was preserved; retry connection or use guided legacy recovery."
        : `Windows runtime ownership is inconclusive (${reason}); existing processes and recovery evidence were preserved. Retry connection.`,
    );
    this.name = "WindowsProviderRuntimeError";
    this.reason = reason;
  }
}

export interface WindowsRuntimeChild {
  readonly pid: number;
  /** An actual direct-child exit event, never a new PID lookup. */
  readonly hasExited: () => boolean;
}

export interface WindowsProviderRuntimeResult {
  readonly endpoint: ProviderDaemonClientConfig;
  readonly rootEndpoint: ProviderDaemonClientConfig;
  readonly marker: ProviderDaemonMarker;
  readonly health: ProviderDaemonHealth;
  readonly adopted: boolean;
  /** Generation or legacy revision, deliberately opaque to watchdog callers. */
  readonly ownershipId: string;
}

export interface WindowsProviderRuntimeObservation {
  readonly status: "same-process" | "exited" | "different-process" | "unknown";
  readonly ownershipId?: string;
}

export interface WindowsProviderRuntimeOptions {
  readonly role: ProviderRuntimeProcessMode;
  readonly markerPath: string;
  readonly legacyCredentialPath: string;
  readonly socketPath: string;
  readonly appVersion: string;
  readonly protocolVersion: number;
  readonly runtimeBuildId?: string;
  readonly cafeMcpPort?: () => number | undefined;
  readonly bootstrap: Omit<
    ProviderDaemonBootstrap,
    "mode" | "transport" | "socketPath" | "token" | "runtimeBuildId" | "windowsOwnershipId"
  >;
  readonly encodeCredential: (token: string) => Promise<{
    readonly base64: string;
    readonly encrypted: boolean;
  }>;
  readonly decodeCredential: (base64: string, encrypted: boolean) => Promise<string>;
  readonly spawn: (bootstrap: ProviderDaemonBootstrap) => Promise<WindowsRuntimeChild>;
  readonly fetchHealth?: (endpoint: ProviderDaemonClientConfig) => Promise<ProviderDaemonHealth>;
  readonly issueLease?: (
    endpoint: ProviderDaemonClientConfig,
  ) => Promise<ProviderDaemonLeaseResponse>;
  readonly openSession?: typeof openWindowsOwnershipSession;
  /** Tests inject time; production deadlines remain bounded, without inference retries. */
  readonly now?: () => number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly readinessTimeoutMs?: number;
}

export interface WindowsProviderRuntime {
  readonly ensure: () => Promise<WindowsProviderRuntimeResult>;
  readonly observe: () => Promise<WindowsProviderRuntimeObservation>;
  readonly stop: (expectedOwnershipId?: string) => Promise<void>;
  readonly recover: (expectedOwnershipId?: string) => Promise<WindowsProviderRuntimeResult>;
  readonly current: () => WindowsProviderRuntimeResult | null;
}

/**
 * Launch a detached child without a scope finalizer that can later kill a recycled
 * PID. Bootstrap is private descriptor data; no token is added to argv or env.
 * A failed descriptor write is deliberately NOT turned into a kill/retry: the
 * runtime controller retains its prepared ownership record until actual exit or
 * authenticated admission proves what happened to this child.
 */
export async function spawnWindowsProviderRuntimeChild(options: {
  readonly executable: string;
  readonly entrypoint: string;
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly bootstrap: ProviderDaemonBootstrap;
  readonly spawnChild?: typeof spawn;
}): Promise<WindowsRuntimeChild> {
  const child = (options.spawnChild ?? spawn)(
    options.executable,
    [options.entrypoint, options.bootstrap.mode, "--bootstrap-fd", "3"],
    {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      detached: true,
      windowsHide: true,
      stdio: ["ignore", "ignore", "ignore", "pipe"],
    } satisfies SpawnOptions,
  );
  let exited = false;
  child.once("exit", () => {
    exited = true;
  });
  // Keep a listener after launch too: subsequent spawn/stdio errors contain
  // machine-specific data and cannot become unhandled diagnostic disclosures.
  child.on("error", () => {});
  await new Promise<void>((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", () => reject(new WindowsProviderRuntimeError("child-admission-uncertain")));
  });
  const pipe = child.stdio[3];
  if (pipe && "write" in pipe) {
    pipe.on("error", () => {});
    try {
      pipe.end(`${JSON.stringify(options.bootstrap)}\n`);
    } catch {
      // Keep the real child handle for exit observation after a partial write.
    }
    if ("unref" in pipe && typeof pipe.unref === "function") pipe.unref();
  }
  child.unref();
  if (child.pid === undefined) throw new WindowsProviderRuntimeError("child-admission-uncertain");
  return { pid: child.pid, hasExited: () => exited };
}

const fail = (reason: WindowsProviderRuntimeFailure): never => {
  throw new WindowsProviderRuntimeError(reason);
};
const sameIdentity = (a: WindowsProcessIdentity, b: WindowsProcessIdentity): boolean =>
  a.pid === b.pid && a.creationTime100ns === b.creationTime100ns;
const decodeMarker = Schema.decodeUnknownSync(ProviderDaemonMarker);
const decodeHealth = Schema.decodeUnknownSync(ProviderDaemonHealth);
const decodeLease = Schema.decodeUnknownSync(ProviderDaemonLeaseResponse);

async function readHealth(endpoint: ProviderDaemonClientConfig): Promise<ProviderDaemonHealth> {
  const response = await requestProviderDaemonJson(endpoint, PROVIDER_DAEMON_HEALTH_PATH, {
    timeoutMs: 3_000,
    maxResponseBytes: 1_048_576,
  });
  if (response.statusCode !== 200) return fail("endpoint-unavailable");
  return decodeHealth(JSON.parse(response.body));
}

function defaultLease(role: ProviderRuntimeProcessMode) {
  return async (endpoint: ProviderDaemonClientConfig): Promise<ProviderDaemonLeaseResponse> => {
    const response = await requestProviderDaemonJson(endpoint, PROVIDER_DAEMON_LEASES_PATH, {
      method: "POST",
      timeoutMs: 3_000,
      maxResponseBytes: 8_192,
      body: JSON.stringify({
        clientKind: role === "provider-daemon" ? "desktop-main" : "provider-daemon",
        capabilities: ["health", "events", "rpc", "lease"],
      }),
    });
    if (response.statusCode !== 200) return fail("lease-unavailable");
    return decodeLease(JSON.parse(response.body));
  };
}

interface RecordSnapshot {
  readonly marker: ProviderDaemonMarker;
  readonly revision: string;
  readonly credentialBase64?: string;
}

/**
 * Windows-only lifecycle policy shared by the desktop daemon and explicit
 * supervisor manager. Each helper session both owns the OS guard and performs
 * the conditional file mutations. This process never writes ownership files.
 */
export function createWindowsProviderRuntime(
  options: WindowsProviderRuntimeOptions,
): WindowsProviderRuntime {
  const open = options.openSession ?? openWindowsOwnershipSession;
  const healthRequest = options.fetchHealth ?? readHealth;
  const leaseRequest = options.issueLease ?? defaultLease(options.role);
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const readinessTimeoutMs = Math.min(Math.max(options.readinessTimeoutMs ?? 30_000, 1), 45_000);
  let active: { readonly result: WindowsProviderRuntimeResult; readonly revision: string } | null =
    null;
  let tail = Promise.resolve();

  // One controller cannot overlap stop/adopt/recover. The helper's OS guard is
  // still required because another Electron/backend process has its own queue.
  const serialize = <A>(operation: () => Promise<A>): Promise<A> => {
    const result = tail.then(operation, operation);
    tail = result.then(
      () => {},
      () => {},
    );
    return result;
  };
  const sessionOperation = async <A>(
    operation: (session: WindowsOwnershipSession) => Promise<A>,
  ) => {
    let session: WindowsOwnershipSession;
    try {
      session = await open({
        markerPath: options.markerPath,
        legacyCredentialPath: options.legacyCredentialPath,
        role: options.role,
      });
    } catch {
      return fail("ownership-unavailable");
    }
    try {
      return await operation(session);
    } catch (error) {
      if (error instanceof WindowsProviderRuntimeError) throw error;
      return fail("ownership-unavailable");
    } finally {
      // A dead helper has already released its native guard. Its loss must not
      // conceal the operation's original sanitized failure or trigger a replay.
      await session.close().catch(() => {});
    }
  };
  const recordFrom = (snapshot: WindowsOwnershipSnapshot): RecordSnapshot | null => {
    if (snapshot.markerJson === null && snapshot.revision === null) return null;
    if (snapshot.markerJson === null || snapshot.revision === null) return fail("invalid-record");
    let marker: ProviderDaemonMarker;
    try {
      marker = decodeMarker(JSON.parse(snapshot.markerJson));
    } catch {
      return fail("invalid-record");
    }
    const transport = marker.transport ?? "tcp";
    let validEndpoint = false;
    if (transport === "ipc") {
      // This controller only owns its configured, role-specific named pipe.
      // Treat arbitrary endpoint substitutions as uncertainty, not authority to
      // send a private token to another listener or erase its recovery records.
      validEndpoint = marker.socketPath === options.socketPath;
    } else {
      try {
        const url = new URL(marker.httpBaseUrl);
        validEndpoint =
          url.protocol === "http:" &&
          ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) &&
          url.username === "" &&
          url.password === "";
      } catch {
        /* Invalid addresses preserve the exact existing record. */
      }
    }
    if (
      (marker.mode ?? "provider-daemon") !== options.role ||
      !validEndpoint ||
      (marker.windowsProcessIdentity && marker.windowsProcessIdentity.pid !== marker.pid)
    ) {
      return fail("invalid-record");
    }
    return {
      marker,
      revision: snapshot.revision,
      ...(snapshot.credentialBase64 === undefined
        ? {}
        : { credentialBase64: snapshot.credentialBase64 }),
    };
  };
  const read = async (session: WindowsOwnershipSession) => recordFrom(await session.read());
  const fence = (record: RecordSnapshot) => record.marker.windowsOwnershipId ?? record.revision;
  const checkExpected = (record: RecordSnapshot | null, expected: string | undefined) => {
    if (expected !== undefined && (record === null || fence(record) !== expected)) {
      return fail("ownership-changed");
    }
  };
  const rootEndpoint = async (record: RecordSnapshot): Promise<ProviderDaemonClientConfig> => {
    let token: string;
    try {
      if (record.credentialBase64 === undefined) {
        // Very old token-in-marker records remain decodable, but are never
        // copied to diagnostics or persisted into newly generated records.
        if (record.marker.token === undefined) return fail("credential-unavailable");
        token = record.marker.token;
      } else {
        token = await options.decodeCredential(
          record.credentialBase64,
          record.marker.credentialEncrypted ?? options.role === "provider-daemon",
        );
      }
      if (token.length < 32) return fail("credential-unavailable");
    } catch {
      return fail("credential-unavailable");
    }
    return {
      httpBaseUrl: record.marker.httpBaseUrl,
      transport: record.marker.transport ?? "tcp",
      ...(record.marker.socketPath === undefined ? {} : { socketPath: record.marker.socketPath }),
      token,
    };
  };
  const observeHealth = async (endpoint: ProviderDaemonClientConfig) => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return decodeHealth(await healthRequest(endpoint));
      } catch {
        if (attempt === 0) await sleep(150);
      }
    }
    return fail("endpoint-unavailable");
  };
  const authMatches = (record: RecordSnapshot, health: ProviderDaemonHealth) => {
    const marker = record.marker;
    return (
      health.mode === options.role &&
      health.pid === marker.pid &&
      (marker.windowsOwnershipId === undefined ||
        (health.windowsOwnershipId === marker.windowsOwnershipId &&
          health.windowsProcessIdentity !== undefined)) &&
      (marker.windowsProcessIdentity === undefined ||
        health.windowsProcessIdentity === undefined ||
        sameIdentity(marker.windowsProcessIdentity, health.windowsProcessIdentity))
    );
  };
  const compatible = (marker: ProviderDaemonMarker, health: ProviderDaemonHealth) =>
    marker.appVersion === options.appVersion &&
    health.version === options.appVersion &&
    marker.protocolVersion === options.protocolVersion &&
    health.protocolVersion === options.protocolVersion &&
    marker.runtimeBuildId === options.runtimeBuildId &&
    health.runtimeBuildId === options.runtimeBuildId &&
    (options.cafeMcpPort?.() === undefined || marker.cafeMcpPort === options.cafeMcpPort?.());
  const publish = async (
    session: WindowsOwnershipSession,
    record: RecordSnapshot | null,
    marker: ProviderDaemonMarker,
    credentialBase64?: string,
  ): Promise<RecordSnapshot> => {
    try {
      const revision = await session.publish({
        expectedRevision: record?.revision ?? null,
        markerJson: JSON.stringify(marker),
        ...(credentialBase64 === undefined ? {} : { credentialBase64 }),
      });
      return {
        marker,
        revision,
        ...(credentialBase64 === undefined
          ? record?.credentialBase64 === undefined
            ? {}
            : { credentialBase64: record.credentialBase64 }
          : { credentialBase64 }),
      };
    } catch {
      // The mutation may already have committed. Do not retry, remove or spawn;
      // the next ensure opens a new guard and re-observes the durable record.
      return fail("mutation-uncertain");
    }
  };
  const retire = async (session: WindowsOwnershipSession, record: RecordSnapshot) => {
    try {
      await session.retire(record.revision);
    } catch {
      return fail("mutation-uncertain");
    }
    if (active && active.result.ownershipId === fence(record)) active = null;
  };
  const staleConflictCheck = async (record: RecordSnapshot) => {
    let endpoint: ProviderDaemonClientConfig;
    try {
      endpoint = await rootEndpoint(record);
    } catch {
      return;
    }
    let health: ProviderDaemonHealth;
    try {
      health = await observeHealth(endpoint);
    } catch {
      return;
    }
    // A successfully authenticated responder contradicts a dead/reused owner.
    // Even a response echoing the old marker must not be dismissed: the helper
    // and endpoint disagree, so no file or process mutation is authorized.
    if (health.ok) return fail("endpoint-conflict");
  };
  const terminate = async (session: WindowsOwnershipSession, record: RecordSnapshot) => {
    const identity = record.marker.windowsProcessIdentity;
    if (!identity) return fail("identity-unknown");
    const outcome = await session.terminate(identity);
    if (outcome.status === "unknown") return fail("termination-uncertain");
    if (outcome.status === "different-process") await staleConflictCheck(record);
    await retire(session, record);
  };
  const requireNoUnboundUpstream = (health: ProviderDaemonHealth) => {
    // A daemon's authenticated health does not grant authority over a separate
    // supervisor PID. Automatic supervisor handoff remains disabled. If an
    // explicitly configured legacy topology is still present, preserve it
    // rather than silently leaving it alive or killing a potentially new owner.
    if (
      options.role === "provider-daemon" &&
      (health.upstreamSupervisor?.configured || health.supervisorProcess !== undefined)
    ) {
      return fail("upstream-ownership-unknown");
    }
  };
  const leaseAndAccept = async (
    session: WindowsOwnershipSession,
    record: RecordSnapshot,
    endpoint: ProviderDaemonClientConfig,
    health: ProviderDaemonHealth,
    adopted: boolean,
  ) => {
    let lease: ProviderDaemonLeaseResponse;
    try {
      lease = decodeLease(await leaseRequest(endpoint));
    } catch {
      return fail("lease-unavailable");
    }
    const identity = record.marker.windowsProcessIdentity;
    if (!identity || (await session.observe(identity)).status !== "same-process")
      return fail("identity-unknown");
    const current = await read(session);
    if (!current || current.revision !== record.revision) return fail("ownership-changed");
    const result: WindowsProviderRuntimeResult = {
      marker: record.marker,
      health,
      rootEndpoint: endpoint,
      endpoint: { ...endpoint, token: lease.token, leaseId: lease.leaseId },
      adopted,
      ownershipId: fence(record),
    };
    active = { result, revision: record.revision };
    return result;
  };

  const admit = async (
    session: WindowsOwnershipSession,
    initial: RecordSnapshot,
    child?: WindowsRuntimeChild,
    allowReplacement = true,
  ): Promise<WindowsProviderRuntimeResult | null> => {
    let record = initial;
    const marker = record.marker;
    const prepared = marker.windowsOwnershipState === "prepared";
    const expectedIdentity = marker.windowsProcessIdentity;
    const before = expectedIdentity
      ? await session.observe(expectedIdentity)
      : marker.pid > 0
        ? await session.capture(marker.pid)
        : { status: "unknown" as const };
    if (before.status === "exited" || before.status === "different-process") {
      if (!allowReplacement) return fail("ownership-changed");
      await staleConflictCheck(record);
      await retire(session, record);
      return null;
    }
    if (before.status === "unknown" && !prepared)
      return fail(expectedIdentity ? "identity-unknown" : "legacy-identity-unknown");
    const endpoint = await rootEndpoint(record);
    let health: ProviderDaemonHealth;
    try {
      health = await observeHealth(endpoint);
    } catch {
      return fail(
        prepared
          ? "prepared-attempt-uncertain"
          : expectedIdentity
            ? "endpoint-unavailable"
            : "legacy-identity-unknown",
      );
    }
    if (prepared) {
      // Generation authentication is the binding to the bootstrap attempt. A
      // post-spawn PID observation alone cannot authorize admission or killing.
      const identity = health.windowsProcessIdentity;
      if (expectedIdentity && identity && !sameIdentity(expectedIdentity, identity)) {
        return fail("endpoint-conflict");
      }
      if (
        !marker.windowsOwnershipId ||
        health.windowsOwnershipId !== marker.windowsOwnershipId ||
        health.mode !== options.role ||
        !identity ||
        identity.pid !== health.pid ||
        (marker.pid !== 0 && health.pid !== marker.pid) ||
        (child && (child.hasExited() || child.pid !== health.pid)) ||
        (await session.observe(identity)).status !== "same-process"
      )
        return fail("child-admission-uncertain");
      record = await publish(session, record, {
        ...marker,
        pid: identity.pid,
        windowsProcessIdentity: identity,
        windowsOwnershipState: "committed",
        updatedAt: new Date(now()).toISOString(),
      });
    } else {
      if (!authMatches(record, health)) return fail("endpoint-conflict");
      if (expectedIdentity) {
        if ((await session.observe(expectedIdentity)).status !== "same-process")
          return fail("identity-unknown");
      } else {
        // Authenticated legacy owners cannot echo a generation never sent to
        // their bootstrap. Upgrade identity only, retain their credential, and
        // use the exact marker revision as the opaque mutation fence.
        if (
          before.status !== "present" ||
          before.identity.pid !== health.pid ||
          (await session.observe(before.identity)).status !== "same-process"
        )
          return fail("legacy-identity-unknown");
        record = await publish(session, record, {
          ...marker,
          windowsProcessIdentity: before.identity,
          updatedAt: new Date(now()).toISOString(),
        });
      }
    }
    if (!compatible(record.marker, health)) {
      if (!allowReplacement) return fail("ownership-changed");
      requireNoUnboundUpstream(health);
      await terminate(session, record);
      return null;
    }
    return leaseAndAccept(session, record, endpoint, health, child === undefined);
  };

  const spawnFresh = async (
    session: WindowsOwnershipSession,
  ): Promise<WindowsProviderRuntimeResult> => {
    // The live helper/guard plus an actual native identity query are the
    // preflight. Unknown means policy/runtime support is unavailable: no spawn.
    if ((await session.capture(process.pid)).status !== "present")
      return fail("ownership-unavailable");
    const ownershipId = randomUUID();
    const token = randomBytes(32).toString("hex");
    let credential: { readonly base64: string; readonly encrypted: boolean };
    try {
      credential = await options.encodeCredential(token);
    } catch {
      return fail("credential-unavailable");
    }
    const timestamp = new Date(now()).toISOString();
    const cafeMcpPort = options.cafeMcpPort?.();
    const marker: ProviderDaemonMarker = {
      version: 2,
      mode: options.role,
      pid: 0,
      ppid: process.pid,
      protocolVersion: options.protocolVersion,
      transport: "ipc",
      httpBaseUrl: "http://provider-daemon.local",
      socketPath: options.socketPath,
      credentialPath: windowsOwnershipCredentialPath(options.legacyCredentialPath, ownershipId),
      credentialEncrypted: credential.encrypted,
      createdAt: timestamp,
      updatedAt: timestamp,
      appVersion: options.appVersion,
      ...(options.runtimeBuildId === undefined ? {} : { runtimeBuildId: options.runtimeBuildId }),
      windowsOwnershipId: ownershipId,
      windowsOwnershipState: "prepared",
      ...(cafeMcpPort === undefined ? {} : { cafeMcpPort }),
    };
    // Prepared pid=0 is a durable reservation, NOT a dead process. A crash or
    // lost response from this publication cannot justify a second child.
    let record = await publish(session, null, marker, credential.base64);
    let child: WindowsRuntimeChild;
    try {
      child = await options.spawn({
        ...options.bootstrap,
        mode: options.role,
        transport: "ipc",
        socketPath: options.socketPath,
        token,
        ...(options.runtimeBuildId === undefined ? {} : { runtimeBuildId: options.runtimeBuildId }),
        windowsOwnershipId: ownershipId,
        ...(cafeMcpPort === undefined ? {} : { cafeMcpPort }),
      });
    } catch {
      return fail("child-admission-uncertain");
    }
    if (!Number.isInteger(child.pid) || child.pid <= 0 || child.pid > 0xffff_ffff)
      return fail("child-admission-uncertain");
    record = await publish(session, record, { ...record.marker, pid: child.pid });
    const deadline = now() + readinessTimeoutMs;
    do {
      if (child.hasExited()) {
        await staleConflictCheck(record);
        await retire(session, record);
        return fail("child-admission-uncertain");
      }
      try {
        const result = await admit(session, record, child);
        if (result) return result;
        return fail("child-admission-uncertain");
      } catch (error) {
        // Retry bounded infrastructure observations only. Never retry mutations
        // or an uncertain lease/admission operation, and never replay a prompt.
        if (
          !(error instanceof WindowsProviderRuntimeError) ||
          error.reason !== "prepared-attempt-uncertain"
        )
          throw error;
      }
      if (now() >= deadline) break;
      await sleep(200);
    } while (now() < deadline);
    return fail("prepared-attempt-uncertain");
  };
  const ensureInSession = async (session: WindowsOwnershipSession) => {
    const record = await read(session);
    if (record) {
      const result = await admit(session, record);
      if (result) return result;
    }
    return spawnFresh(session);
  };
  const stopInSession = async (session: WindowsOwnershipSession, expected?: string) => {
    let record = await read(session);
    checkExpected(record, expected);
    if (!record) {
      active = null;
      return;
    }
    const identity = record.marker.windowsProcessIdentity;
    if (identity) {
      const observed = await session.observe(identity);
      if (observed.status === "exited" || observed.status === "different-process") {
        await staleConflictCheck(record);
        await retire(session, record);
        return;
      }
      if (observed.status === "unknown") return fail("identity-unknown");
    }
    // A previously authenticated cached binding authorizes stopping that exact
    // record even when its event loop is no longer responding. Other records
    // must authenticate now before the native same-handle action is allowed.
    if (!active || active.revision !== record.revision) {
      const adopted = await admit(session, record);
      if (!adopted) return;
      record = await read(session);
      if (!record || !active || active.revision !== record.revision)
        return fail("ownership-changed");
    }
    requireNoUnboundUpstream(active.result.health);
    await terminate(session, record);
  };
  return {
    ensure: () => serialize(() => sessionOperation(ensureInSession)),
    current: () => active?.result ?? null,
    observe: () =>
      serialize(async () => {
        const expected = active?.result.ownershipId;
        if (!active) return { status: "unknown" as const };
        try {
          return await sessionOperation(async (session) => {
            const record = await read(session);
            checkExpected(record, expected);
            if (!record?.marker.windowsProcessIdentity || active?.revision !== record.revision) {
              return {
                status: "unknown" as const,
                ...(expected === undefined ? {} : { ownershipId: expected }),
              };
            }
            const outcome = await session.observe(record.marker.windowsProcessIdentity);
            return {
              status: outcome.status,
              ...(expected === undefined ? {} : { ownershipId: expected }),
            };
          });
        } catch {
          return {
            status: "unknown" as const,
            ...(expected === undefined ? {} : { ownershipId: expected }),
          };
        }
      }),
    stop: (expected) =>
      serialize(() => sessionOperation((session) => stopInSession(session, expected))),
    recover: (expected) =>
      serialize(() =>
        sessionOperation(async (session) => {
          const record = await read(session);
          if (
            expected !== undefined &&
            record &&
            fence(record) !== expected &&
            active &&
            active.revision === record.revision
          ) {
            // Another serialized ensure already accepted the new generation after
            // the watchdog took its snapshot. Revalidate that binding without any
            // replacement authority and return its lease so the stopped backend
            // can reconnect; stale snapshots never kill or overwrite the new owner.
            const current = await admit(session, record, undefined, false);
            if (current) return current;
            return fail("ownership-changed");
          }
          await stopInSession(session, expected);
          return ensureInSession(session);
        }),
      ),
  };
}
