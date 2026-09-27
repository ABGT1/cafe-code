/**
 * Explicit, isolated native Windows qualification. Never run from default unit
 * discovery: this exercises Win32 handles and helper death using only children
 * and temporary ownership files created by this invocation. It needs no Cafe
 * profile, provider binary, account credentials, or inference calls.
 */
import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir, release } from "node:os";
import { dirname, join } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import {
  captureWindowsProcessIdentity,
  observeWindowsProcess,
  openWindowsOwnershipSession,
  terminateWindowsProcess,
  windowsOwnershipCredentialPath,
  WindowsOwnershipError,
  type WindowsOwnershipDependencies,
  type WindowsOwnershipSession,
  type WindowsProcessIdentity,
} from "@cafecode/shared/windowsProcessOwnership";

const FIXTURE_SWITCH = "--ownership-fixture-child";
const TEST_TOKEN = "synthetic-native-ownership-token-000000000000000000";
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function readPowerShellEnvironment(): Promise<{ version: string; languageMode: string }> {
  const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT;
  if (systemRoot === undefined || !/^[A-Za-z]:\\/.test(systemRoot) || systemRoot.includes("\0")) {
    throw new Error("Trusted Windows system directory unavailable.");
  }
  return new Promise((resolve, reject) => {
    const child = spawn(
      join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "$PSVersionTable.PSVersion.ToString(); $ExecutionContext.SessionState.LanguageMode.ToString()",
      ],
      {
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: { SystemRoot: systemRoot, WINDIR: systemRoot },
      },
    );
    let output = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("PowerShell environment probe timed out."));
    }, 15_000);
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (output.length > 1_024) {
        child.kill();
        reject(new Error("PowerShell environment probe exceeded its limit."));
      }
    });
    child.stderr.on("data", () => {});
    child.once("error", () => {
      clearTimeout(timeout);
      reject(new Error("PowerShell environment probe unavailable."));
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      const [version, languageMode] = output.trim().split(/\r?\n/);
      if (
        code !== 0 ||
        version === undefined ||
        !/^\d+(?:\.\d+){1,3}$/.test(version) ||
        languageMode === undefined ||
        !/^(FullLanguage|ConstrainedLanguage|RestrictedLanguage|NoLanguage)$/.test(languageMode)
      ) {
        reject(new Error("PowerShell environment probe returned invalid metadata."));
      } else resolve({ version, languageMode });
    });
  });
}

/** Isolate native host startup without provider data or ownership operations. */
async function probePowerShellPipeStartup(): Promise<void> {
  const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT;
  assert.ok(systemRoot && /^[A-Za-z]:\\/.test(systemRoot));
  const executable = join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const script =
    '[Console]::Out.WriteLine("started"); [Console]::Out.Flush(); $encoding = New-Object System.Text.UTF8Encoding($false); [Console]::Out.WriteLine("constructed"); [Console]::Out.Flush(); [Console]::InputEncoding = $encoding; [Console]::Out.WriteLine("encoding"); [Console]::Out.Flush(); $line = [Console]::In.ReadLine(); if ($line -eq "fixture") { [Console]::Out.WriteLine("received"); [Console]::Out.Flush() }; exit 0';
  const cases = [
    { name: "new-object-open", directConstructor: false, pinnedModules: false },
    { name: "direct-constructor-open", directConstructor: true, pinnedModules: false },
    { name: "new-object-pinned-module-open", directConstructor: false, pinnedModules: true },
  ];
  await Promise.all(
    cases.map(
      (entry) =>
        new Promise<void>((resolve) => {
          const started = performance.now();
          const source = entry.directConstructor
            ? script.replace(
                "New-Object System.Text.UTF8Encoding($false)",
                "[Text.UTF8Encoding]::new($false)",
              )
            : script;
          const child = spawn(
            executable,
            [
              "-NoLogo",
              "-NoProfile",
              "-NonInteractive",
              "-EncodedCommand",
              Buffer.from(source, "utf16le").toString("base64"),
            ],
            {
              shell: false,
              windowsHide: true,
              stdio: "pipe",
              env: {
                SystemRoot: systemRoot,
                WINDIR: systemRoot,
                PATH: join(systemRoot, "System32"),
                TEMP: process.env.TEMP,
                TMP: process.env.TMP,
                ...(entry.pinnedModules
                  ? {
                      PSModulePath: join(
                        systemRoot,
                        "System32",
                        "WindowsPowerShell",
                        "v1.0",
                        "Modules",
                      ),
                    }
                  : {}),
              },
            },
          );
          const phases: string[] = [];
          let buffered = "";
          let stderrBytes = 0;
          let finished = false;
          const finish = (outcome: string, code?: number | null) => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            console.info(
              JSON.stringify({
                phase: "native-host-probe",
                variant: entry.name,
                outcome,
                phases,
                stderrBytes,
                durationMs: Math.round(performance.now() - started),
                ...(code === undefined ? {} : { exitCode: code }),
              }),
            );
            resolve();
          };
          const timer = setTimeout(() => {
            child.kill();
            finish("timeout");
          }, 15_000);
          child.stdout.on("data", (chunk: Buffer) => {
            buffered += chunk.toString("utf8");
            if (buffered.length > 1_024) {
              child.kill();
              finish("oversize");
              return;
            }
            while (buffered.includes("\n")) {
              const newline = buffered.indexOf("\n");
              const line = buffered.slice(0, newline).trim();
              buffered = buffered.slice(newline + 1);
              if (
                line === "started" ||
                line === "constructed" ||
                line === "encoding" ||
                line === "received"
              )
                phases.push(line);
              else {
                child.kill();
                finish("invalid-output");
                return;
              }
            }
          });
          child.stderr.on("data", (chunk: Buffer) => {
            stderrBytes += chunk.length;
          });
          child.on("error", () => finish("spawn-error"));
          child.stdin.on("error", () => {});
          child.on("exit", (code) => finish("exited", code));
          child.stdin.write("fixture\n");
        }),
    ),
  );
}

async function waitForExit(child: ChildProcessWithoutNullStreams): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (child.exitCode === null && child.signalCode === null && Date.now() < deadline) {
    await sleep(25);
  }
  assert.ok(child.exitCode !== null || child.signalCode !== null, "fixture child must exit");
}

async function startFixture(): Promise<ChildProcessWithoutNullStreams> {
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), FIXTURE_SWITCH], {
    windowsHide: true,
    shell: false,
    stdio: "pipe",
    // Native fixture bootstrap receives no inherited provider credentials or
    // selected Node hooks. Its lifetime is controlled by this private stdin.
    env: {
      SystemRoot: process.env.SystemRoot ?? process.env.SYSTEMROOT,
      WINDIR: process.env.WINDIR,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
    },
  });
  child.stderr.on("data", () => {});
  child.on("error", () => {});
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Native fixture did not become ready.")),
      10_000,
    );
    child.stdout.once("data", (chunk: Buffer) => {
      clearTimeout(timeout);
      if (chunk.toString("utf8").trim() === "ready") resolve();
      else reject(new Error("Native fixture sent an invalid ready response."));
    });
    child.once("error", () => {
      clearTimeout(timeout);
      reject(new Error("Native fixture could not start."));
    });
  });
  return child;
}

/**
 * Lose one real helper mutation response after the actual operation completed.
 * This is a test transport fault, not a production mutation hook: the native
 * helper remains the sole lock holder and file mutator. A fresh helper must
 * recover by reading committed bytes, never by replaying the lost request.
 */
function faultTransport() {
  let helper: ChildProcessWithoutNullStreams | undefined;
  let dropResponse = false;
  const dependency: WindowsOwnershipDependencies = {
    spawn: (executable, args, options) => {
      helper = spawn(executable, [...args], { ...options, stdio: "pipe" });
      const original = helper.stdout;
      const forwarded = new PassThrough();
      original.on("data", (chunk: Buffer) => {
        if (dropResponse) {
          // The test owns this disposable helper, never the daemon/fixture PID.
          // Its death releases the same guard that protected this mutation.
          helper?.kill();
        } else forwarded.write(chunk);
      });
      original.on("end", () => forwarded.end());
      Object.defineProperty(helper, "stdout", { value: forwarded });
      return helper;
    },
  };
  return {
    dependency,
    loseNextResponse: () => {
      dropResponse = true;
    },
    killHelper: async () => {
      assert.ok(helper, "expected an owned helper child");
      helper.kill();
      await waitForExit(helper);
    },
  };
}

export async function runWindowsProcessOwnershipSmoke(): Promise<void> {
  if (process.platform !== "win32")
    throw new Error("Native ownership qualification requires Windows.");
  const root = await mkdtemp(join(tmpdir(), "cafecode-windows-ownership-"));
  let child: ChildProcessWithoutNullStreams | undefined;
  let identity: WindowsProcessIdentity | undefined;
  const sessions = new Set<WindowsOwnershipSession>();
  const results: Record<string, boolean> = {};
  const timing: Record<string, number> = {};
  const open = async (
    role: "daemon" | "supervisor",
    dependencies?: WindowsOwnershipDependencies,
  ) => {
    const markerPath = join(root, role, "state", `provider-${role}.json`);
    const legacyCredentialPath =
      role === "daemon"
        ? join(dirname(markerPath), "provider-daemon-token.bin")
        : join(root, role, "secrets", "provider-supervisor-token");
    await mkdir(dirname(markerPath), { recursive: true });
    await mkdir(dirname(legacyCredentialPath), { recursive: true });
    const session = await openWindowsOwnershipSession(
      { markerPath, legacyCredentialPath, role },
      dependencies,
    );
    sessions.add(session);
    return { session, markerPath, legacyCredentialPath };
  };
  const close = async (session: WindowsOwnershipSession) => {
    await session.close().catch(() => {});
    sessions.delete(session);
  };
  try {
    const powershell = await readPowerShellEnvironment();
    console.info(
      JSON.stringify({
        phase: "native-environment",
        powershell,
        node: process.version,
        windowsBuild: release(),
        runnerImageVersion: process.env.ImageVersion ?? null,
      }),
    );
    await probePowerShellPipeStartup();
    child = await startFixture();
    assert.ok(child.pid);
    let started = performance.now();
    const captured = await captureWindowsProcessIdentity(child.pid, {
      onStartupPhase: (phase) =>
        console.info(
          JSON.stringify({
            phase: "native-helper-startup",
            helperPhase: phase,
            durationMs: Math.round(performance.now() - started),
          }),
        ),
    });
    timing.coldCaptureMs = Math.round(performance.now() - started);
    // Fixed native outcomes diagnose setup/policy failures without printing the
    // helper's raw stdout/stderr, target command line, PID or filesystem paths.
    console.info(
      JSON.stringify({
        phase: "native-capture",
        status: captured.status,
        ...(captured.status === "present" || captured.reason === undefined
          ? {}
          : { reason: captured.reason }),
        durationMs: timing.coldCaptureMs,
      }),
    );
    assert.equal(
      captured.status,
      "present",
      "native helper must capture the disposable child's FILETIME",
    );
    if (captured.status !== "present") throw new Error("Disposable child identity unavailable.");
    identity = captured.identity;
    assert.equal(typeof identity.creationTime100ns, "string");
    results.capture = true;
    const owner = await open("daemon");
    started = performance.now();
    assert.equal((await owner.session.observe(identity)).status, "same-process");
    timing.hotObserveMs = Math.round(performance.now() - started);
    const wrongIdentity = {
      ...identity,
      creationTime100ns: (BigInt(identity.creationTime100ns) + 1n).toString(),
    };
    assert.equal((await owner.session.observe(wrongIdentity)).status, "different-process");
    assert.equal((await owner.session.terminate(wrongIdentity)).status, "different-process");
    assert.equal((await owner.session.observe(identity)).status, "same-process");
    results.wrongIdentityNeverTerminates = true;

    await assert.rejects(
      open("daemon"),
      (error: unknown) => error instanceof WindowsOwnershipError && error.reason === "lock-busy",
    );
    results.concurrentGuardExclusion = true;
    const ownershipId = randomUUID();
    const credentialPath = windowsOwnershipCredentialPath(owner.legacyCredentialPath, ownershipId);
    const unrelatedCredential = windowsOwnershipCredentialPath(
      owner.legacyCredentialPath,
      randomUUID(),
    );
    await writeFile(unrelatedCredential, "unrelated synthetic generation");
    const prepared = {
      version: 2,
      mode: "provider-daemon",
      protocolVersion: 1,
      pid: identity.pid,
      httpBaseUrl: "http://provider-daemon.local",
      transport: "ipc",
      socketPath: `\\\\.\\pipe\\cafecode-ownership-fixture-${ownershipId}`,
      credentialPath,
      credentialEncrypted: false,
      createdAt: "2026-09-27T00:00:00.000Z",
      updatedAt: "2026-09-27T00:00:00.000Z",
      appVersion: "0.0.0-native-test",
      windowsOwnershipId: ownershipId,
      windowsProcessIdentity: identity,
      windowsOwnershipState: "prepared",
    };
    assert.deepEqual(await owner.session.read(), { markerJson: null, revision: null });
    const preparedRevision = await owner.session.publish({
      expectedRevision: null,
      markerJson: JSON.stringify(prepared),
      credentialBase64: Buffer.from(TEST_TOKEN).toString("base64"),
    });
    const committed = { ...prepared, windowsOwnershipState: "committed" };
    const committedRevision = await owner.session.publish({
      expectedRevision: preparedRevision,
      markerJson: JSON.stringify(committed),
    });
    assert.notEqual(committedRevision, preparedRevision);
    await assert.rejects(
      owner.session.retire(preparedRevision),
      (error: unknown) =>
        error instanceof WindowsOwnershipError && error.reason === "ownership-changed",
    );
    await assert.rejects(
      owner.session.publish({
        expectedRevision: preparedRevision,
        markerJson: JSON.stringify(prepared),
      }),
      (error: unknown) =>
        error instanceof WindowsOwnershipError && error.reason === "ownership-changed",
    );
    assert.equal((await owner.session.read()).revision, committedRevision);
    results.staleRevisionPreservesNewGeneration = true;
    await close(owner.session);

    const crash = faultTransport();
    const crashOwner = await open("daemon", crash.dependency);
    await crash.killHelper();
    await assert.rejects(crashOwner.session.read());
    await close(crashOwner.session);
    const afterCrash = await open("daemon");
    assert.equal((await afterCrash.session.read()).revision, committedRevision);
    await close(afterCrash.session);
    results.helperDeathReleasesGuard = true;

    const lostReply = faultTransport();
    const uncertainOwner = await open("daemon", lostReply.dependency);
    lostReply.loseNextResponse();
    const republished = { ...committed, updatedAt: "2026-09-27T00:00:01.000Z" };
    await assert.rejects(
      uncertainOwner.session.publish({
        expectedRevision: committedRevision,
        markerJson: JSON.stringify(republished),
      }),
    );
    await close(uncertainOwner.session);
    const recovered = await open("daemon");
    const recoveredSnapshot = await recovered.session.read();
    assert.ok(recoveredSnapshot.revision);
    assert.notEqual(recoveredSnapshot.revision, committedRevision);
    assert.deepEqual(JSON.parse(recoveredSnapshot.markerJson!), republished);
    assert.equal(
      Buffer.from(recoveredSnapshot.credentialBase64!, "base64").toString("utf8"),
      TEST_TOKEN,
    );
    results.lostMutationReplyRecoveredByObservation = true;
    await recovered.session.retire(recoveredSnapshot.revision);
    assert.deepEqual(await recovered.session.read(), { markerJson: null, revision: null });
    await assert.rejects(readFile(credentialPath), { code: "ENOENT" });
    assert.equal(await readFile(unrelatedCredential, "utf8"), "unrelated synthetic generation");
    results.exactGenerationCleanup = true;
    await close(recovered.session);

    // Supervisors deliberately keep marker and credentials in different pinned
    // directories. Exercise the same native transaction authority for that role.
    const supervisor = await open("supervisor");
    const supervisorId = randomUUID();
    const supervisorMarker = {
      ...committed,
      mode: "provider-supervisor",
      windowsOwnershipId: supervisorId,
      credentialPath: windowsOwnershipCredentialPath(supervisor.legacyCredentialPath, supervisorId),
    };
    const supervisorRevision = await supervisor.session.publish({
      expectedRevision: null,
      markerJson: JSON.stringify(supervisorMarker),
      credentialBase64: Buffer.from(TEST_TOKEN).toString("base64"),
    });
    await supervisor.session.retire(supervisorRevision);
    assert.deepEqual(await supervisor.session.read(), { markerJson: null, revision: null });
    await close(supervisor.session);
    results.supervisorSeparateCredentialDirectory = true;

    assert.equal((await terminateWindowsProcess(identity)).status, "exited");
    await waitForExit(child);
    const afterExit = await observeWindowsProcess(identity);
    assert.ok(afterExit.status === "exited" || afterExit.status === "different-process");
    results.sameHandleTerminationConfirmed = true;
    const helperSource = await readFile(
      new URL("../packages/shared/src/windowsProcessOwnershipScript.ts", import.meta.url),
    );
    const lockfile = await readFile(new URL("../yarn.lock", import.meta.url));
    console.info(
      JSON.stringify({
        ok: true,
        platform: process.platform,
        windowsBuild: release(),
        architecture: process.arch,
        node: process.version,
        powershell,
        runnerImageVersion: process.env.ImageVersion ?? null,
        helperSourceSha256: createHash("sha256").update(helperSource).digest("hex"),
        lockfileSha256: createHash("sha256").update(lockfile).digest("hex"),
        checks: results,
        timingMs: timing,
      }),
    );
  } finally {
    for (const session of sessions) await close(session);
    if (identity !== undefined && child?.exitCode === null && child.signalCode === null)
      await terminateWindowsProcess(identity);
    // The fixture's stdin EOF is a cooperative exit, not a raw PID signal.
    child?.stdin.end();
    if (child !== undefined) await waitForExit(child);
    await rm(root, { recursive: true, force: true, maxRetries: 40, retryDelay: 250 });
  }
}

if (import.meta.main) {
  if (process.argv[2] === FIXTURE_SWITCH) {
    process.stdout.write("ready\n");
    process.stdin.resume();
    process.stdin.once("end", () => process.exit(0));
    // Independent backstop if the parent loses its streams during a test crash.
    setTimeout(() => process.exit(0), 120_000);
  } else {
    await runWindowsProcessOwnershipSmoke();
  }
}
