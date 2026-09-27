# Windows daemon ownership uses process identity, not PID existence

Created: 2026-09-27 18:58:45 JST (UTC+0900)
Last updated: 2026-09-27 21:01:26 JST (UTC+0900)
Decision status: accepted for implementation by the user's explicit Windows fix request.
Implementation status: implemented and verified; deterministic checks, native Windows qualification and final forced desktop rebuild passed.
Supersession: none.

## Context

Windows can recycle a saved daemon PID for an unrelated process after the daemon exits. A PID-existence test cannot distinguish that occupant from Cafe's owner. Preserving an uncertain live owner is necessary for long-running work, but retaining a proven stale record forever blocks startup. Checking identity and then killing by PID is also unsafe: the PID can be reused between those operations.

## Decision

The Windows daemon and explicitly enabled supervisor share a Node-only ownership controller. macOS and Linux retain their existing lifecycle implementations. Shared contracts add optional Windows identity metadata; old records continue to decode, and POSIX writers omit the new fields.

Windows ownership binds the PID to the exact creation FILETIME, stored losslessly as a decimal string. New attempts also carry a random ownership generation through private bootstrap data. The child captures its own identity once before readiness. The parent authenticates the child's identity/generation and independently verifies the native identity before committing ownership. These correlation values do not replace capability-token authentication.

A fixed, hidden system PowerShell helper owns native process handles and the exclusive per-role file guard. It performs conditional marker/credential mutations itself while holding that guard; Node never writes under a lock held only by a separate process. Publication uses prepared/committed records and generation-scoped credentials. Mutations compare the captured marker revision, and delayed cleanup cannot retire a different generation. A lost mutation response requires re-observation, not a blind retry.

Process observations distinguish same process, different process, confirmed exit and unknown. Access denial, helper timeout, unreadable records, malformed responses and missing identity remain unknown. Termination compares creation identity and acts through the same native handle, then confirms exit with a bounded wait. There is no PID-only kill fallback, privilege escalation, policy bypass, or broad process scan.

Authenticated legacy owners may gain native identity without rotating their credentials or restarting sessions. A legacy PID that still exists but cannot authenticate remains inconclusive; marker timestamps, process names and age are not substitutes for OS identity. An unbound prepared attempt can recover only through an authenticated reply carrying its exact bootstrap generation and child identity followed by independent native verification. Otherwise it remains parked unless its exact child exit is proven.

The desktop watchdog observes native ownership only after authenticated liveness fails. Healthy cycles remain cheap. Unknown ownership or quiet reasoning never triggers a restart. Verified stale ownership permits backend stop, fenced daemon replacement and backend restart with a newly issued lease; a stale watchdog generation cannot replace a newer owner. Supervisor cleanup uses its own independent authority and never inherits authority from a cached upstream PID.

If replacement or backend restart fails after the backend was stopped, the watchdog retains an explicit pending-recovery state. Subsequent bounded-backoff attempts re-observe/admit the durable current or prepared generation through `ensure`; they do not repeat the old termination. User quit still wins before backend restart. A healthy daemon alone cannot clear this state before the backend reconnects.

Cross-role cleanup closes and confirms exit of the daemon's guard helper before opening the supervisor guard. The supervisor controller checks its own authenticated generation and birth identity, then the daemon transaction reacquires its guard and requires the same marker revision and fresh upstream health. A newly reported positive supervisor owner aborts the older cleanup. No nested role locks, cached-PID kills or automatic supervisor handoff are introduced.

Current finite budgets are 15 seconds per helper operation, 120 seconds per helper session, 5 seconds for guard acquisition and 3 seconds each for same-handle exit wait/helper close. These are failure bounds, not ownership evidence. Control HTTP requests have absolute deadlines in addition to idle socket timeouts. Protocol input/output and ownership records are bounded; helper errors use an allowlist. Native qualification passed within these budgets on the recorded runner; slower or policy-restricted hosts still fail closed rather than acquiring authority from a timeout.

## Alternatives and consequences

Timeout-based deletion and process-name allowlists were rejected because neither establishes identity. CIM-only timestamps do not solve the termination check/use race. A compiled helper remains an alternative if constrained Win32 interop cannot qualify; the safety requirements must not be weakened to accommodate helper failure.

The helper is Windows-only, hidden, shell-free, profile-free, bounded, and selected from the system directory. Private structured standard streams carry credentials and record bodies, never argv or diagnostics. Ownership paths are constrained to the role's expected files and must reject reparse redirection. Debugging exposes fixed outcomes rather than helper output or raw errors.

The fixed bootstrap uses the direct .NET UTF-8 constructor and loads only the inbox PowerShell Utility module before compiling the Win32 boundary. A bounded startup handshake prevents JSON requests from racing initialization of the helper's final reader. Native Windows qualification caught a stalled command-based encoding initializer; it was corrected without expanding the authority or disabling policy checks.

Windows may expose temporary/profile directories through 8.3 aliases. The helper validates the original and canonical drive-absolute spellings, rejects traversal and ambiguous separators, and pins every canonical ancestor against replacement while rejecting reparse points. Credential alias comparison never changes the mutation target: reads and writes use only the configured, pinned legacy path or its validated generation-derived path. Interrupted multi-file publication/retirement can leave an orphan generation credential; it is preserved as private recovery evidence, never reused for another generation or bulk-deleted automatically.

Updated writers coordinate through one native guard. Old concurrent binaries do not honor it, so mixed-version writers for one profile are unsupported. Downgrade requires an explicit controlled stop/recovery, not deleting new metadata from a live owner's record. Policy-blocked helpers and uncertain legacy owners may require guided manual recovery. The design does not defend against an adversary already controlling the same user's executable and private profile.

## Verification and replay

Deterministic schema, controller, desktop watchdog and supervisor tests must cover uncertainty, reused identity, authenticated conflicts, failed admission, generation races and failed termination. Native process/lock tests are isolated opt-in Windows tests using synthetic credentials and disposable children, never live provider accounts. Native evidence must cover same-handle termination, wrong-identity refusal, guard exclusion/crash recovery and packaged helper availability.

Required final checks use the repository's pinned Node/Corepack Yarn toolchain: formatting, lint, typecheck, tests, then a forced desktop build. Native Windows results and source identity are recorded separately from macOS build success. Replay instructions and the manual Windows-only CI entry point are documented in [reliability canaries](../reliability-canaries.md).

Native source and packaged qualification passed in [Windows run 36316366254](https://github.com/cafeai/cafe-code/actions/runs/36316366254), source `0b62e8a5c875b86c308fa58c4e4eb004a3f636a2`. The disposable runner used Windows Server 2025 build `10.0.26100`, image `windows-2025-vs2026` version `20260922.246.2`, Windows PowerShell `5.1.26100.33438` in FullLanguage mode, Node `24.13.1`, Yarn `4.17.1`, and Electron `42.5.1`. Cold capture took 2230 ms and hot observation 4 ms. The native smoke verified wrong-identity refusal, exact-handle termination, concurrent/alias guard exclusion, stale revision fencing, helper death and lost-reply recovery at publication/retirement boundaries, and junction/traversal rejection. The installer smoke verified authenticated daemon/backend readiness, renderer hydration, managed runtime, clean shutdown and uninstall. No live user credentials or provider inference were used.

Replay input digests: lockfile SHA-256 `0f1c7321f23f5246e097834656605f093134b7aaa0319d08f8908b04afa81beb`; fixed helper source SHA-256 `ffebe554ce5a42fcabba92c15c63fa2a303a6d87695c7181ca8dd7fdf7b3a31f`. These identify the tested inputs, not a promise that a moving hosted runner image will reproduce timing or installer bytes exactly.

The final workflow-inclusive [Windows run 36316749642](https://github.com/cafeai/cafe-code/actions/runs/36316749642) also passed at source `e115c29e899663e40f270c6796cc7844a8c89fa0`; its only change from the preceding qualified source was installer-identity logging. It recorded the same helper/lock digests and environment, 3021 ms cold capture and 4 ms hot observation. The tested `Cafe-Code-0.2.0-x64.exe` was 398400470 bytes with SHA-256 `f3f86373f6b57a9a556d15e38bfd8d05f63cdf2df8118c2ab70188c075290b90`. Packaged install/runtime/uninstall completed successfully at `2026-09-27T11:57:48.3723070Z` on the Windows runner.

Local macOS verification with Node `24.13.1` and Yarn `4.17.1` passed `yarn fmt`, `yarn lint`, `yarn typecheck`, and `yarn test`, followed by `yarn build:desktop --force` (three build tasks, zero cache hits) at 2026-09-27 21:01:26 JST (UTC+0900). The local checkout includes preserved unrelated in-progress work; clean Windows qualification used only the scoped implementation snapshot above. The unrelated work is excluded from this change's commit.

## Primary API references

- [Process handles and identifiers](https://learn.microsoft.com/en-us/windows/win32/procthread/process-handles-and-identifiers)
- [GetProcessTimes](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-getprocesstimes)
- [OpenProcess](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-openprocess)
- [TerminateProcess](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-terminateprocess)
- [WaitForSingleObject](https://learn.microsoft.com/en-us/windows/win32/api/synchapi/nf-synchapi-waitforsingleobject)
