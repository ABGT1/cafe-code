# Codex 0.159 compatibility and subscription readiness

Created: 2026-09-29 18:40:20 JST (UTC+0900)
Last updated: 2026-09-29 19:01:18 JST (UTC+0900)
Status: implemented and verified; not committed or pushed.

## Release and scope

The installed CLI reports 0.159.0. Cafe's protocol generator moves from 0.158.0 commit `064c6b8c737f5b41d171fdda80bd9ef10ad06eb3` to the exact stable 0.159.0 release commit `687a119f0fcaace47e1f1abcc77cec6c813fd6da`. The official annotated release tag resolves to that commit and is dated `2026-09-29T06:52:06Z`. The provider binary is not installed or changed by this source update.

The [official app-server documentation](https://learn.chatgpt.com/docs/app-server) defines account reads, sparse quota notifications, named buckets and earned-reset metadata. Public subscription pricing and rollout dates are not inferred from new plan identifiers. Existing `prolite`, `pro` and `promax` labels remain supported without guessing quota multipliers or monthly prices.

## Changes

- Regenerate all public protocol types from the immutable release. `tooManyDenials` must survive error and failed/interrupted turn envelopes. A native denial is a provider outcome, never a transport-retry signal or permission bypass.
- Normalize only well-formed unfamiliar plan identifiers to the upstream `unknown` sentinel before strict decoding. Preserve valid account/quota data while keeping authentication variants and all other fields validated. See [the compatibility decision](decisions/codex-account-metadata-compatibility.md).
- Carry optional quota alias `normalModelSlug` and provider-reported additional-bucket credit/limit metadata through existing full and rolling update paths. Full idle-account usage reads also decode upstream's nested `spend_control` and `individual_limit.reset_at` spelling while retaining older flattened payload compatibility; credit and spend metadata never inherit across independent buckets.
- Share compact quota presentation between provider settings and chat context surfaces. Display named buckets without duplicating the canonical legacy view, derive reset labels from reported durations, and show supplied credit/spending-limit details. Unknown amounts remain unavailable, not zero; decimal balance strings are not converted into a fabricated currency. Earned resets remain distinct from usage credits and their authoritative count stays at the bottom.

Security review added strict account notification projection to remove undeclared provider fields before canonical persistence, and own-property construction for quota map keys so a literal `__proto__` remains inert data. No new model requests, startup probes, billing mutations, credential handling, provider restarts or speculative subscription pricing are introduced. Existing sparse merging, account-change clearing, quota refresh admission and explicit reset confirmation remain authoritative. No platform-specific launcher or sandbox behavior changes.

The native idle-usage spelling was checked against the immutable [OpenAI backend client implementation](https://github.com/openai/codex/blob/687a119f0fcaace47e1f1abcc77cec6c813fd6da/codex-rs/backend-client/src/client.rs), specifically `rate_limit_snapshots_from_payload`, `make_rate_limit_snapshot` and `map_individual_limit`.

## Token and feature decisions

The inspected 0.159 public model and token-usage schemas retain existing usage counters and context metadata. No new proven token-saving setting is enabled. Native cache affinity, bounded history resume and existing helper prompt policies remain in place. Experimental `multiAgentMode` is deprecated/ignored and must not become a Cafe toggle; supported reasoning efforts continue through the existing model catalog and request path. Public agent-concurrency settings retain the prior shape and Cafe's existing child/total conversion.

## Verification and replay

Base revision: `477a405f491ca269a2042e2024c1ae87d02d2d56` on `dev`, with pre-existing uncommitted Desk UI changes preserved. Toolchain: Node 24.13.1 and Corepack Yarn 4.17.1 on macOS ARM64. Existing locked dependencies are reused; no runtime package is upgraded. Run the protocol package's `generate` script to reproduce its checked-in surface from the pinned commit.

Focused fixtures cover new denial terminal outcomes, future subscription metadata, malformed-account rejection, quota preservation and shared presentation. Final checks are `corepack yarn fmt`, `corepack yarn lint`, `corepack yarn typecheck`, `corepack yarn test --concurrency=2 -- --maxWorkers=2`, targeted browser tests, then `corepack yarn build:desktop --force` as the final software verification.

Verification results:

- `corepack yarn fmt`, `corepack yarn lint` and `corepack yarn typecheck`: passed. Lint retains pre-existing warnings; newly added schema validators are module-hoisted.
- `corepack yarn test --concurrency=2 -- --maxWorkers=2`: all 10 tasks passed, 4,987 tests passed and 3 explicitly skipped.
- Targeted browser run: 51 tests passed across shared quota details, composer context details, pinned session rail, reset dialog and provider settings. Includes narrow width, short rail, 20-bucket scrolling, escaped provider strings and fixed reset-count footer.
- Independent review: account metadata normalization/strict projection, terminal-denial outcomes, bucket isolation and native WHAM compatibility reviewed. One initially failing sanitation regression and a widened test-fixture literal were corrected before the final checks.
- `corepack yarn build:desktop --force`: passed as the final software verification; all 3 build tasks ran uncached and completed in 23.3 seconds.

Logs and dirty-source replay evidence are retained in `/tmp/cafe-codex159-fixes.WhlGe7`: final gate logs, `working-tree.patch`, `untracked-source.tar.gz`, `source-files.sha256`, and `replay-artifacts.sha256`. The patch/archive include the preserved pre-existing Desk work because verification covers the combined source tree. Apply them only to the recorded base in an isolated checkout; no tracked or experimental artifacts are published. No paid inference, real earned-reset consumption, app restart, or native Windows qualification is claimed.
