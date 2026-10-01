# Provider compatibility and token preservation — October 2, 2026

Created: 2026-10-02 06:48:28 JST (UTC+0900)
Last updated: 2026-10-02 07:08:06 JST (UTC+0900)
Status: implementation complete; full repository checks and forced desktop build passed.

Scope: stable provider updates since the [September 30 audit](provider-updates-2026-09-30.md), including Claude's intervening patches. No global CLI installation, account change, app restart or paid inference is performed. The configured executable remains authoritative; updating Cafe's imported SDK does not replace it. Public installed package metadata currently reports Codex 0.160.0 and Claude Code 2.1.287; this is not a live runtime qualification.

## Versions and supply-chain evidence

| Component                | Audit/adoption                    | Immutable evidence                                                                                                            |
| ------------------------ | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Codex native source      | 0.159.3 and latest stable 0.160.0 | `01fc69f4026735edfdf6789820549727a4867b11` and `a956835d020762cb2b570053af06f643a11c0ecc`                                     |
| Codex generated protocol | Retain 0.159.0                    | `687a119f0fcaace47e1f1abcc77cec6c813fd6da`; complete protocol/schema trees still match                                        |
| Claude Agent SDK         | Adopt 0.3.286 from 0.3.283        | All three manifests and Yarn lock move together; nine archive SHA-512 checks and 18 valid registry signature entries          |
| Claude native source     | Review 2.1.284–2.1.287            | Immutable Code changelog `52c76441cae91f6891e4712306bffb057ff6fec5`; SDK changelog `9d8cb9c1ae68672c343d75723440b73afe5b993c` |

Sources: [Codex 0.160.0 release](https://github.com/openai/codex/releases/tag/rust-v0.160.0), [Codex 0.159.3 release](https://github.com/openai/codex/releases/tag/rust-v0.159.3), [SDK package metadata](https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk/0.3.286), [immutable SDK changelog](https://github.com/anthropics/claude-agent-sdk-typescript/blob/9d8cb9c1ae68672c343d75723440b73afe5b993c/CHANGELOG.md), [immutable Code changelog](https://github.com/anthropics/claude-code/blob/52c76441cae91f6891e4712306bffb057ff6fec5/CHANGELOG.md).

Claude 0.3.286's youngest sibling was published `2026-09-30T18:04:32.291Z`; the complete set cleared the existing 24-hour hold at `2026-10-01T18:04:32.291Z`. Every embedded package manifest matches its registry identity, platform constraints and dependency/script fields. Registry signatures establish consistency with registry-signed metadata, not an independent publisher attestation; the 18 entries are not asserted to be 18 distinct signing keys.

Wrapper SRI: `sha512-InL/UNmRGSwBM/81PME0J0TZDsDBBlweWqRZgq2XSViSIg2hBi8nIL8j9Hm6MHRH85wgDJQE5n6Vo/r9hIO0NQ==`.

Newest SDK 0.3.287 remains held at this observation. Codex source compatibility is separate from installation: 0.159.3's complete package set clears at `2026-10-01T23:05:42.268Z`, and 0.160.0 at `2026-10-02T20:34:11.032Z`. This audit does not reinstall or downgrade a user-configured CLI, bypass age checks, or claim that labels install native fixes.

## Cafe integration changes

- The existing account/quota subscription formatter follows Codex's revised native status names: Pro 100/200/500, Business, Business Premium and Enterprise variants. Names are display metadata, not inferred prices, quota multipliers or entitlements. Unknown plans remain generic; sparse usage cannot promote authentication or copy another account's tier. Legacy cached labels remain displayable until refresh. [Native formatter](https://github.com/openai/codex/blob/a956835d020762cb2b570053af06f643a11c0ecc/codex-rs/tui/src/subscription.rs).
- Claude Manual now passes explicit `permissionMode: "default"` at query creation, including resume. SDK 0.3.286 no longer inserts that value for an omitted option, so relying on omission could inherit Auto from native settings. This security-sensitive fix preserves Cafe's chosen approval policy; it does not disable Auto, Plan or explicitly selected Bypass. Existing user/project/local settings sources and first-prompt control ordering remain intact.
- Sonnet 5.5 is a data-driven fallback row gated on CLI 2.1.284, with Medium default and five native effort choices. It has native 1M context, no Fast option and no fabricated selectable 200K variant. Add explicit 5.5 aliases while retaining Cafe's preexisting bare Sonnet alias mapping, explicit Sonnet 5 selections and new-chat default. A global alias advance would bypass the CLI gate and assume the same native target on older/gateway deployments; native aliases are backend/version-dependent and need runtime-aware qualification before Cafe changes their legacy meaning. Live initialization metadata remains authoritative. Existing Sonnet 5 family pricing already supplies its standard rates; a regression test locks that coverage and user overrides. [Claude model configuration](https://code.claude.com/docs/en/model-config), [Fast mode](https://code.claude.com/docs/en/fast-mode).
- Codex's full collaboration-mode object must not fill an omitted effort with Cafe's old fixed Medium fallback. Retain only the already observed selected native effort from the exact runtime's start/resume response and root settings notifications; explicit Cafe effort wins. An observed native null delegates to native defaults, whereas unknown is not permission to reset a choice. Guard later settings/admission against old ACKs. No new model/account probe or prompt replay is needed. [Native config snapshot](https://github.com/openai/codex/blob/a956835d020762cb2b570053af06f643a11c0ecc/codex-rs/core/src/session/session.rs), [full mode replacement](https://github.com/openai/codex/blob/a956835d020762cb2b570053af06f643a11c0ecc/codex-rs/core/src/session/step_settings.rs).

These are changes inside established metadata and provider-policy boundaries; no new persistence format, transport, trust boundary or ADR is required.

## Native changes that Cafe must not duplicate

Codex 0.160.0's public protocol tree is `01988e423904843f6b005fa640750aa3cd7b97b6`, schema tree `93532610871f7bb0c9e2bc8aebb39224991550f7`, and bundled catalog blob `77e0389c56000ca19df5029278c30c3e9528af51`, unchanged from 0.159.2. Account/goal contracts and normal start/resume/steer paths are unchanged. Keep the existing generator pin and live model-list authority; there is no new model/pricing fallback to add.

Native catalog refresh/explicit-catalog precedence, skill deduplication, parsed-plugin caching, HTTP-pool reuse and incremental task status belong to the configured CLI. Skill deduplication can reduce redundant prompt bytes; discovery/I/O caching is not necessarily billed-token savings. New Guardian flags remain under-development/default-off. The 0.159.3 TUI security reminder has no app-server notification; Cafe does not add credential-bearing status reads or polling. [Skill deduplication](https://github.com/openai/codex/blob/a956835d020762cb2b570053af06f643a11c0ecc/codex-rs/ext/skills/src/render_dedup.rs), [model catalog authority](https://github.com/openai/codex/blob/a956835d020762cb2b570053af06f643a11c0ecc/codex-rs/models-manager/src/manager.rs).

Claude's native patches improve compaction/resume/MCP consistency, model-switch context limits and interrupted parallel-tool recovery. Its auth/tool sandbox hardening stays provider-owned. Wrapper 0.3.286 adopts available streaming/background-wake and fork-history fixes; the newer 0.3.287 wrapper's additional streaming/cache changes are not adopted before quarantine expiry. Existing public message discriminants, cumulative per-model usage and child-inclusive accounting remain compatible. Optional MCP-manifest/provider-allowlist fields stay inert in Cafe, while native managed settings continue to apply.

## Token and concurrency audit

Keep native conversation identity, bounded paginated resume, stable helper prompts, combined metadata generation, read-on-demand attachment sidecars, Claude's bare system preset/title seed, unused prompt suggestions off, optional Concise output/progress-summary suppression and explicit Fast-off behavior. Do not force cache TTL, after-final compaction, provider prompts or experimental context polling. No measured cache-hit or account-specific token-savings claim is made.

Codex's removed `remote_compaction_v2` flag and stable/default-on `compaction_image_budget` retain their native policy. The model-visible compaction tool catalog and image gates are unchanged. Preserve upstream truncation/retention budgets rather than introducing competing automatic compaction. No live paid compaction smoke was run.

Codex retains the public positive-`usize` spawned-agent key and legacy alias, V1 six spawned children, V2 four total resident threads, explicit V2 precedence, public N→N+1 translation and inherited omission. Cafe's optional 1–64 bound remains its own safety ceiling. Claude's verified native 2.1.286 ARM64 artifact retains the positive digit-only concurrent-subagent override, default 20, local Agent admission and existing remote/manual/Ultracode exceptions. Its artifact SHA-256 is `75e3016e9d2570767b08e43a7467d4817a4f149232c169ca295f2c95fef21433`; it was inspected as inert data, never executed.

Known accounting scope is unchanged: Claude settles child-inclusive totals separately from primary context; Codex currently reports the primary native thread's observations, not an independently qualified full-tree child ledger. Missing historical observations cannot be fabricated. Codex ephemeral helper JSON still cannot prove the effective model and remains counted but unpriced when unreported. Disabling all inherited Codex helper tools has no qualified single public control; an empty MCP table can deep-merge rather than disable configured servers, so no unsafe blanket override is introduced.

## Verification and replay

Environment: macOS ARM64, Node 24.13.1, Corepack Yarn 4.17.1; initial clean base `a1c40f6ad540a814501a467e06155a57eb7e8641`. Setup: `corepack yarn install --immutable`. Fresh dependency replay used an archive of that base plus the three changed manifests and lockfile; `install --immutable --mode=skip-build` passed, then SDK version/import and existing public API checks passed without invoking a provider. The skip-build flag is only for dependency-resolution replay, not desktop verification. Replay directory: `/tmp/cafe-provider-oct2-replay.LRmwEu`.

Package evidence: `/tmp/cafe-claude-oct2-audit.1McE1j/provenance-286/report.json`. Root independently reverified the retained nine archives, signature entries and age gate. Native source: `/tmp/cafe-codex160-audit.bMMdqc/upstream`.

Focused provider tests (262), shared model/pricing tests (50) and toolchain policy tests (5) passed after the update. The final Codex runtime regression run passed 118 tests, including native effort inheritance, delayed settings/admission and stale acknowledgement fencing. `yarn fmt`, `yarn lint` and `yarn typecheck --concurrency=1` passed. `yarn test --concurrency=2 -- --maxWorkers=2` passed all ten packages: 5,103 tests passed and three existing tests skipped. `yarn build:desktop --force` passed after tests, rebuilding all three build tasks without cache hits. Tests use credential-free synthetic fixtures; they do not establish native Windows runtime, paid-provider or 16-hour workload qualification.

The verified software patch, excluding this audit document and AGENTS documentation, has SHA-256 `2434a9ec1444449b0352dcfc390823280b4f1126b550be207dddad4754f7b109`; the lockfile has SHA-256 `0a0a715bd8e10505e33df746a0a64ea6614720996f48ad4129006455cc2698ae`. Local gate logs and the patch fingerprint are retained under the ignored `.plans/95-evidence/` directory. Existing lint warnings outside the changed provider runtime remain; a passing lint gate is not a warning-free claim.
