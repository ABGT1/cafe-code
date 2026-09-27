# Reliability canaries

The `Reliability and dependency canaries` workflow runs manually or twice weekly
against `dev`. It is separate from PR checks because package registries, native
installers, process handoff and wall-clock load are external dependencies.
GitHub enables scheduled triggers only after this workflow is present on the
repository's default branch; pushing it to `dev` alone does not activate the
schedule. The normal release merge should promote the workflow unchanged.

- Dependency scanning includes every workspace and transitive dependency, with
  no security-advisory exceptions. Deprecation warnings are not classified as
  vulnerabilities; inspect them separately during normal package maintenance.
- Process checks use synthetic provider events and isolated daemon fixtures on
  macOS/Linux. They exercise real process restart and health under large-event
  load without provider accounts or inference.
- Packaged macOS/Linux/Windows checks install or extract the produced artifact, run
  the existing runtime self-test and authenticated backend/renderer readiness
  checks, then clean up only test-owned processes and files.

Windows daemon ownership qualification additionally runs the explicit
`node scripts/windows-process-ownership-smoke.ts` command on a disposable
Windows runner before building its artifact. It uses private temporary records,
synthetic credentials and self-expiring test children, not a user's Cafe profile.
It verifies wrong-birth refusal, same-handle termination, exclusive guards,
generation-fenced publication/retirement, helper death and lost-reply recovery.
The packaged smoke also requires authenticated Windows process identity and
bootstrap-generation metadata from its isolated daemon. See the
[ownership decision](decisions/windows-daemon-process-identity.md) and the
Windows-specific notes in `AGENTS.md` for safety and rollout limitations.

For a review branch, the existing CI manual dispatcher accepts
`windows_ownership_only=true` and calls just that Windows canary lane at the
selected ref. For example:

```sh
gh workflow run ci.yml --ref <review-branch> -f windows_ownership_only=true
```

This explicit qualification does not replace normal push/PR checks or change
their platform matrix. Scheduled reliability runs retain all three packaged
platforms against `dev`. Native logs record actual OS/runner/PowerShell versions,
fixed outcomes, helper/lock digests and timings; never credential contents or
private record bodies.

Run the credential-free process checks locally with the pinned toolchain:

```sh
corepack yarn workspace @cafeai/cafe-code exec vitest run --config vitest.e2e.config.ts integration/providerDaemonRestart.e2e.test.ts integration/providerPipelineLiveness.e2e.test.ts
corepack yarn npm audit --all --recursive --no-deprecations
```

Real-account provider canaries remain explicit opt-ins. Never configure account
credentials for scheduled PR/untrusted-branch execution or silently run paid
prompts as part of installation. For native artifact commands and platform
prerequisites, use the existing `test:native-*-artifact` commands after building
the corresponding artifact; Windows installer smoke requires an isolated CI
runner or its existing explicit local opt-in.

Failure triage should distinguish readiness, provider ownership, event journal
durability, canonical ingestion, accounting settlement and renderer delivery.
Retry only bounded, idempotent infrastructure observations or the exact storage
write when its owner explicitly guarantees replay safety. Windows ownership
publication and retirement are not replayable after an ambiguous response:
reacquire the native guard and re-observe the durable generation before deciding
the next action, even when the proposed bytes are identical. Never resend an
inference prompt merely because its acknowledgement was lost.
