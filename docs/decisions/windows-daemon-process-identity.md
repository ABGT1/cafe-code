# Windows daemon ownership uses process identity, not PID existence

Created: 2026-09-27 18:58:45 JST (UTC+0900)
Last updated: 2026-09-27 20:33:06 JST (UTC+0900)
Decision status: accepted for implementation by the user's explicit Windows fix request.
Implementation status: in progress; native Windows qualification pending.
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

Current finite budgets are 15 seconds per helper operation, 120 seconds per helper session, 5 seconds for guard acquisition and 3 seconds each for same-handle exit wait/helper close. These are failure bounds, not ownership evidence. Control HTTP requests have absolute deadlines in addition to idle socket timeouts. Protocol input/output and ownership records are bounded; helper errors use an allowlist. Native qualification must establish these budgets are sufficient on the supported runtime.

## Alternatives and consequences

Timeout-based deletion and process-name allowlists were rejected because neither establishes identity. CIM-only timestamps do not solve the termination check/use race. A compiled helper remains an alternative if constrained Win32 interop cannot qualify; the safety requirements must not be weakened to accommodate helper failure.

The helper is Windows-only, hidden, shell-free, profile-free, bounded, and selected from the system directory. Private structured standard streams carry credentials and record bodies, never argv or diagnostics. Ownership paths are constrained to the role's expected files and must reject reparse redirection. Debugging exposes fixed outcomes rather than helper output or raw errors.

The fixed bootstrap uses the direct .NET UTF-8 constructor and loads only the inbox PowerShell Utility module before compiling the Win32 boundary. A bounded startup handshake prevents JSON requests from racing initialization of the helper's final reader. Native Windows qualification caught a stalled command-based encoding initializer; it was corrected without expanding the authority or disabling policy checks.

Windows may expose temporary/profile directories through 8.3 aliases. The helper validates the original and canonical drive-absolute spellings, rejects traversal and ambiguous separators, and pins every canonical ancestor against replacement while rejecting reparse points. Credential alias comparison never changes the mutation target: reads and writes use only the configured, pinned legacy path or its validated generation-derived path. Interrupted multi-file publication/retirement can leave an orphan generation credential; it is preserved as private recovery evidence, never reused for another generation or bulk-deleted automatically.

Updated writers coordinate through one native guard. Old concurrent binaries do not honor it, so mixed-version writers for one profile are unsupported. Downgrade requires an explicit controlled stop/recovery, not deleting new metadata from a live owner's record. Policy-blocked helpers and uncertain legacy owners may require guided manual recovery. The design does not defend against an adversary already controlling the same user's executable and private profile.

## Verification and replay

Deterministic schema, controller, desktop watchdog and supervisor tests must cover uncertainty, reused identity, authenticated conflicts, failed admission, generation races and failed termination. Native process/lock tests are isolated opt-in Windows tests using synthetic credentials and disposable children, never live provider accounts. Native evidence must cover same-handle termination, wrong-identity refusal, guard exclusion/crash recovery and packaged helper availability.

Required final checks use the repository's pinned Node/Corepack Yarn toolchain: formatting, lint, typecheck, tests, then a forced desktop build. Native Windows results and source identity must be recorded separately from macOS build success. No verification is claimed by this initial decision record.

## Primary API references

- [Process handles and identifiers](https://learn.microsoft.com/en-us/windows/win32/procthread/process-handles-and-identifiers)
- [GetProcessTimes](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-getprocesstimes)
- [OpenProcess](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-openprocess)
- [TerminateProcess](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-terminateprocess)
- [WaitForSingleObject](https://learn.microsoft.com/en-us/windows/win32/api/synchapi/nf-synchapi-waitforsingleobject)
