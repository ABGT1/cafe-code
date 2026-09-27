# Provider compatibility and token preservation — September 27, 2026

Created: 2026-09-27 10:52:05 JST (UTC+0900)
Last updated: 2026-09-27 11:02:48 JST (UTC+0900)
Status: implemented and verified locally.

Scope: September 20–27 releases, extending the [September 23](provider-updates-2026-09-23.md) and [September 25](provider-updates-2026-09-25.md) audits. Existing uncommitted dictation, lifecycle and mockup work is preserved. No global provider installation, credentials, active sessions, selected models, effort or permission policies were changed. Native CLI fixes apply only when the configured executable contains them; updating Cafe's imported SDK does not replace a user-configured binary.

## Qualified versions and provenance

| Component                | Adopted target                                             | Evidence                                                                                                                                                                                       |
| ------------------------ | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex generated protocol | 0.157.1, commit `36650394c5b38c2990ccf2a3457165ca3e9d9726` | Stable release published September 26 at 01:02:31 UTC. Protocol subtree hash `bcde443fb3e2488e8105f2a597331343f7b69f3c` is identical to 0.157.0. Regeneration changes only provenance headers. |
| Claude Agent SDK         | 0.3.283, from 0.3.278                                      | Server, scripts and staged desktop pins move together. Wrapper plus all eight native siblings are present, with nine SHA-512 checks and 18 valid registry signatures.                          |
| Claude native runtime    | SDK parity target 2.1.283                                  | Public SDK declarations and native release notes audited separately. The user's configured executable remains authoritative and unchanged.                                                     |

The youngest Claude package was published at `2026-09-25T18:49:24.792Z`; the complete set cleared the existing 24-hour quarantine at `2026-09-26T18:49:24.792Z`. No age bypass was used. All embedded manifests match registry identities/platform constraints, with no new native dependencies or lifecycle scripts. Checks were reverified with Node 24.13.1. Registry signatures establish consistency with registry-signed metadata, not an independently supplied publisher attestation.

Wrapper SRI: `sha512-KB+mqU5JLbH2sztlSQeCOu71bK6padYAha3uacBzxFSOVfuRTywYzvsC9P+qV6gXmPXcu98FaPqQv6vBF9j8hA==`.

Sources: [Codex release](https://github.com/openai/codex/releases/tag/rust-v0.157.1), [immutable Codex tree](https://github.com/openai/codex/tree/36650394c5b38c2990ccf2a3457165ca3e9d9726), [Claude package metadata](https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk/0.3.283), [immutable SDK changelog](https://github.com/anthropics/claude-agent-sdk-typescript/blob/9e1902d8c3043d44684f52801b261b2c83e7f201/CHANGELOG.md), [Claude Code changelog](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md).

## Cafe changes

- Regenerated Codex types from the exact 0.157.1 source. No request/schema or lifecycle change was required, preserving older payload compatibility.
- Updated all three Claude SDK pins and the Yarn lockfile. Wrapper cancellation cleanup and correct history/fork branch selection are adopted without replacing Cafe's queue or recovery state machines.
- Sanitized new Claude `system/init.plugin_errors` before native logs, raw runtime events and configured-session persistence. Arbitrary plugin names, paths, messages and future fields are omitted; only fixed category/count summaries remain. Work is bounded to 64 inspected errors, with a separate uninspected count. Malformed values and unknown categories are safe; absence remains unknown instead of asserting a clean plugin load. This is a security-sensitive diagnostics fix, not a change to plugin execution or permissions.
- Corrected Codex shadow-home settings copy: authentication overlays share conversation and SQLite state by default; they do not provide database isolation. Runtime behavior and private authentication files are unchanged.

The 0.157.1 native patch addresses Windows Code Mode/MCP console windows and daemon Job/stdio ownership. These fixes belong in the configured Codex runtime, not a second Cafe process-management implementation. Platform guidance lives in AGENTS.md's Windows section.

## Compatibility decisions

The Claude 0.3.278→0.3.283 public type comparison adds no top-level message discriminant or model-usage counter. Existing informational warnings, action-required states, rate-limit events and native retries remain supported. The new reset trigger, message correlation and timestamp are optional information, not permission to finish a queued input or reorder events. Existing reset and usage-epoch handling remains authoritative.

The thinking control's omitted budget now means unchanged, whereas explicit `null` resets the budget. Cafe has no active invocation of this control and does not synthesize undocumented omitted arguments. Legacy callback, usage, session and queue fixtures remain in the full regression suite. New `attribution: false` support does not require changing Cafe's backward-compatible object form.

New SDK surfaces intentionally remain unused: alpha `prewarm()` requires a distinct trust/session ownership design; `/core` is an optional packaging entrypoint, not a token-saving control; MCP Apps resources require a sandboxed UI host; verbatim prompts would change slash commands and attachment expansion; paste and scheduled-fire provenance must reflect real user/host authority. No new tool access, API polling, prompt replay or automatic provider installation is introduced.

## Token and cache review

Claude 2.1.281–2.1.282 fixes reconstructed resume history, pending-permission history and MCP tool-list stability, reducing native cache invalidation and preserving earlier reasoning. Compaction fallback and 2.1.283 deferred-tool/usage fixes also remain native responsibilities. Cafe preserves the stable prompt preset, selected native session, inherited settings and provider compaction rather than reconstructing history or adding retries. The imported wrapper also reduces SDK load overhead; that is startup work, not measured token savings.

Codex's weekly releases preserve parent cache affinity for ephemeral forks and improve content-based token estimation. Native compaction includes descendant channel posts in its summary input but removes them from retained follow-up context. Checkpoint replay and discovery caching mostly improve correctness/local I/O. Version 0.157.1 does not alter these paths. Sources: [cache affinity](https://github.com/openai/codex/commit/bc5957eac9e89e66f990ed490d11e625a4a3b02c), [token estimation](https://github.com/openai/codex/commit/b04a2c264516ec2e6b3c91dd73ad18a21fd5a88f), [retained-context reduction](https://github.com/openai/codex/commit/c117207a6f1f948ac7fcdd5e784d75fc4e9d13e1).

Existing Cafe savings controls remain intact: optional Claude Concise output and progress-summary suppression, disabled unused prompt suggestions, stable helper prompts, explicit Fast-off semantics, and read-on-demand attachments. No additional proven Cafe-level token optimization is missing in this release delta. No account-specific savings or cache-hit improvement is claimed; no inference was run to measure them.

## Concurrent-agent re-audit

Codex retains `agents.max_concurrent_threads_per_session` and legacy `max_threads`, minimum one positive `usize` with no additional upstream ceiling. V1 defaults to six spawned children; V2 defaults to four resident threads including the root. Explicit V2 total wins, otherwise public spawned N translates to N+1. Model/backend selection and idle-child unloading remain native. Cafe preserves omission and its optional 1–64 safety bound. Sources: [canonical key/alias](https://github.com/openai/codex/blob/36650394c5b38c2990ccf2a3457165ca3e9d9726/codex-rs/config/src/config_toml.rs#L714), [resolution](https://github.com/openai/codex/blob/36650394c5b38c2990ccf2a3457165ca3e9d9726/codex-rs/core/src/config/mod.rs#L2733), [resident capacity](https://github.com/openai/codex/blob/36650394c5b38c2990ccf2a3457165ca3e9d9726/codex-rs/core/src/agent/control/residency.rs#L124).

Claude retains `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`, positive digit-only integer input, default 20 and local Agent-admission semantics rather than a universal process/fork limit. Static inspection of the verified 2.1.283 macOS ARM64 artifact confirms the minimum-one parser, default 20, running-subagent counter and existing feature/ultracode exceptions. Remote launches bypass this local admission check; manual forks/resumes retain their distinct native accounting. Cafe's existing optional override remains unchanged. The binary was inspected as inert data, never executed.

## Verification and replay

Environment: macOS ARM64, Node 24.13.1, Corepack Yarn 4.17.1. No new toolchain or external service is required. Setup: `corepack yarn install --immutable`; all three pinned manifests and `yarn.lock` must be kept together. Fresh replay used a clean archive of base `13e083846b676f9260e62c1149f5660e49ac5469` plus only those four updated files: `corepack yarn install --immutable --mode=skip-build` passed, then SDK import/version/API checks and all five toolchain-policy tests passed. No provider function or binary was invoked. The skip-build flag applies only to this dependency-resolution replay, not final desktop verification. Evidence is in `/tmp/cafe-provider-replay-20260927.F9KsD9/replay-report.json`.

The full dirty-tree source snapshot used for verification is `/tmp/cafe-provider-sept27-checks.ExEbtW/source-snapshot.tar.gz`, SHA-256 `a5d8d0dff0b6ba585d90c14ec29b5f4a1ccf5ecf7b5e2388c2c8ccc01cd276b7`. It retains required uncommitted source inputs and excludes dependency/build output and the unrelated `.claude`/`output` directories. Documentation completion notes may postdate that snapshot; runtime sources are unchanged. This is successful replay, not a claim of byte-identical builds across operating systems.

Focused coverage: 27 Codex protocol tests, 44 settings tests, 144 Claude adapter tests including the new metadata privacy cases. Independent review found no actionable issue in the three diagnostics boundaries or backward-compatible omission behavior.

Full `yarn fmt`, `yarn lint` and `yarn typecheck` passed; lint retains existing warnings outside the changed code. All ten typecheck tasks passed in 46.013 seconds. `yarn test --concurrency=2 -- --maxWorkers=2` passed all ten tasks with 4,760 tests and three existing skips in 2m42.519s. The subsequent `yarn build:desktop --force` passed all three tasks without cache reuse in 25.071 seconds. Logs are retained in `/tmp/cafe-provider-sept27-checks.ExEbtW`; the forced build is repeated after final documentation formatting. Provenance evidence is retained locally in `/tmp/cafe-claude-provenance-20260927.mGSmQH`. Tests use credential-free fixtures and do not establish live paid-provider, native Windows runtime or 16-hour production qualification. No push or app restart was performed.
