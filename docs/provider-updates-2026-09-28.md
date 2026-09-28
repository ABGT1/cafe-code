# Provider compatibility and token preservation — September 28, 2026

Created: 2026-09-28 14:58:43 JST (UTC+0900)
Last updated: 2026-09-28 15:07:37 JST (UTC+0900)
Status: implemented and verified locally.

This audit extends the [September 27 review](provider-updates-2026-09-27.md), including the relevant last-week token/cache changes. It qualifies the installed Codex update without replacing executable installations, changing accounts, restarting the app, running paid inference, or changing permission policies. No package dependency or lockfile update is necessary. Updating generated Cafe types does not install a native provider.

## Release evidence

| Component        | Previous target                                     | Current target and immutable evidence                                                                                     |
| ---------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Codex protocol   | 0.157.1, `36650394c5b38c2990ccf2a3457165ca3e9d9726` | 0.158.0, `064c6b8c737f5b41d171fdda80bd9ef10ad06eb3`; published `2026-09-28T05:07:23Z`. Installed CLI reports 0.158.0.     |
| Claude Code      | 2.1.283                                             | Unchanged. Installed CLI reports 2.1.283; registry rechecked `2026-09-28T05:46:52Z` with no newer non-prerelease release. |
| Claude Agent SDK | 0.3.283 in all three manifests                      | Unchanged. Installed declarations and wrapper match the registry-verified archive.                                        |

Sources: [Codex release](https://github.com/openai/codex/releases/tag/rust-v0.158.0), [immutable Codex source](https://github.com/openai/codex/tree/064c6b8c737f5b41d171fdda80bd9ef10ad06eb3), [immutable Claude changelog](https://github.com/anthropics/claude-code/blob/7779afb12e3635f46f56ec823979d68350ae000b/CHANGELOG.md), [immutable SDK changelog](https://github.com/anthropics/claude-agent-sdk-typescript/blob/9e1902d8c3043d44684f52801b261b2c83e7f201/CHANGELOG.md), [SDK registry metadata](https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk/0.3.283).

Claude's wrapper and eight native siblings retain the identities qualified by the September 27 audit. Today's recheck verified all 18 registry signatures, downloaded and verified the wrapper SHA-512, and compared the installed declarations/wrapper byte-for-byte. It did not redownload all native tarballs or repeat yesterday's nine archive integrity checks. The youngest artifact was published `2026-09-25T18:49:24.792Z` and cleared the 24-hour quarantine `2026-09-26T18:49:24.792Z`. The installed macOS ARM64 native artifact SHA-256 is `d8cb1e5c79684cc12a8bfc813e3a2073406921b6245744b3009be3ab5651d21e`; it was inspected as data, not executed. The conservative CLI `stable` tag still points at 2.1.274, while published `latest`/`next` point at 2.1.283; this is not a reason to downgrade the already qualified target.

## Implemented Cafe changes

1. Regenerated the app-server contract from the exact Codex 0.158.0 source. `PlanType` gains `promax`; `CodexErrorInfo` gains `flexUnavailable`. All public method parameter shapes otherwise remain compatible. Retired hosted-plugin extension exports and the `PluginSummary.extensions` field disappear; older summaries containing that extra field still decode, safely discarding the unused metadata. No repository consumer depends on the removed exports.
2. Updated the shared subscription formatter to match the native Pro-family labels: `prolite` → Pro, `pro` → Pro (More), `promax` → Pro (Max). Do not infer 5x/20x multipliers from these current names. Existing cached labels remain displayable until authoritative metadata refreshes them. New tiers flow through existing account reads, quota notifications and lightweight status reads without adding probes or model calls. Unknown plans remain generic; sparse quota responses cannot promote an unauthenticated/API-key account or leak a previous account's tier.
3. Added regression coverage for the new account and failure variants, old plugin summaries, both settings layouts, and failed-root/continuing-child handling. Flex-capacity failures preserve their native error details and `willRetry`/failed-turn authority. They are not transport failures and do not trigger a new Cafe retry or silently change the paid service tier.

Native label reference: [0.158 status formatter](https://github.com/openai/codex/blob/064c6b8c737f5b41d171fdda80bd9ef10ad06eb3/codex-rs/tui/src/status/helpers.rs#L100-L118).

## Native features and compatibility decisions

- Terminal-input approval is now stable and default-enabled. Cafe already handles it with a request-correlated, redacted approval callback; that safety boundary remains enabled. Guardian thread context is now unconditional, so Cafe does not force the retired feature flag.
- Transparent image generation and file-backed image editing are native tool behavior. The public image/input wire shapes do not change, and Cafe must not duplicate provider tools or upload attachments automatically.
- New native schema-budget and MCP catalog-readiness controls remain omitted. Larger tool schemas can increase prompt tokens; catalog-only readiness changes startup/failure timing. Defaults and explicit user configuration remain authoritative.
- Experimental direct-message disabling, in-memory agent boards and deferred mailbox preemption are not enabled. They would change delivery semantics, not provide a proven Cafe-level token optimization.
- Sensitive native final-response/Guardian telemetry stays opt-in. There is no new diagnostic exposure, credential handling, permission bypass, remote executor support or prompt logging in this patch.
- Codex's catalog removes an older embedded model, but Cafe's live `model/list` remains authoritative and its broader legacy fallback preserves explicit saved choices. This audit does not delete user model settings.

These decisions preserve the current lifecycle, Stop authority, native session identity and security model. No new ADR is needed because no ownership or trust boundary changes.

## Tokens, caching, context and pricing

Codex's public last/total input, cache-read, cache-write, output, reasoning and model-context usage structures are unchanged and already mapped. Astra/Sol/Luna context metadata does not change in this release, so Cafe does not alter context-window limits. The current [OpenAI pricing table](https://developers.openai.com/api/docs/pricing) was checked against Cafe's existing standard API estimates; no release-driven price change is needed. These estimates are not a subscription invoice or an exact service-tier/long-context bill.

The following upstream work is inherited through the configured native CLI, not through extra Cafe prompts:

- [Unchanged-model compaction shortcut](https://github.com/openai/codex/commit/af09e926d69353fcaa17f17f966a11062c0e7297) and [preserved original text/annotations](https://github.com/openai/codex/commit/bd3d4d1436bb41b94fd38ba9bdd34d74524e7a9f).
- [Retained Guardian instruction deduplication](https://github.com/openai/codex/commit/85928697a46fe2500f5b9dfcc094af1e95d822f9) and [tool-observation budgeting](https://github.com/openai/codex/commit/53446f90a56692dede3c8f413e8d486a6adb77b5).
- [Cached WebSocket resume/prewarm](https://github.com/openai/codex/commit/f5f08c54cb7a774594d3579c5731ea3e87f01c48) and [default paginated local history](https://github.com/openai/codex/commit/12cb14f7b70f57aaf643d10ca072c44b555992d1). Cafe already requests bounded, one-turn, `notLoaded` resume snapshots instead of hydrating a multi-hour transcript.

Claude's last-week resume-history and MCP tool-list stability fixes remain covered by the September 27 update. Its existing cumulative resumed-usage baseline, child-inclusive aggregate usage, deduplication and crash fallback remain compatible. Primary context-window usage stays independent from child totals. Cafe preserves stable prompt presets, native session titles, unused prompt suggestions off, optional Concise output, explicit Fast-off semantics and inherited native cache settings. Forcing one-hour cache writes could cost more and is not added. See [official SDK cost accounting](https://code.claude.com/docs/en/agent-sdk/cost-tracking).

There is no additional evidenced Cafe-level token optimization missing in these release deltas. No account-specific token savings, cache-hit improvement or paid workload benchmark is claimed.

## Concurrent-agent defaults

The Codex 0.158 source retains `agents.max_concurrent_threads_per_session`, legacy `max_threads`, minimum one positive `usize`, and no upstream numeric maximum. V1 defaults to six spawned children; V2 defaults to four resident threads including the root. Explicit V2 totals win, otherwise public spawned N translates to N+1. Model/backend/feature precedence and idle-child unloading remain native. Cafe's optional 1–64 safety ceiling, dual override and omission behavior remain correct.

Claude retains `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`, positive digit-only integer parsing and default 20 for local Agent admission, with its existing fork/resume/remote/ultracode exceptions. Static inspection of the verified 2.1.283 artifact agrees with the [official concurrency documentation](https://code.claude.com/docs/en/sub-agents#concurrent-subagent-limit). Cafe does not replace omission with a hard-coded default.

## Verification and replay

Environment: macOS ARM64, Node 24.13.1, Corepack Yarn 4.17.1; base `6a20fca848c08e5c92fa959825e1aceebe172560`. All manifests and `yarn.lock` are unchanged. Setup: `corepack yarn install --immutable`; use the repository package generator with its pinned source to reproduce the generated surface. Default tests use credential-free fixtures, not live providers.

Focused checks passed: 29 generated-protocol tests plus package typecheck; 80 subscription/registry tests; 11 settings unit tests; 14 Chromium settings tests; 206 adapter/runtime tests including Flex and failed-root regression coverage. Independent review normalized the generated diff and found no actionable compatibility or security issue. The large schema diff is predominantly declaration ordering plus retired, unused extension definitions.

Full `corepack yarn fmt`, `corepack yarn lint` and `corepack yarn typecheck` passed. Lint retains existing warnings outside the changed code; all ten typecheck tasks passed in 29.118 seconds. `corepack yarn test --concurrency=2 -- --maxWorkers=2` passed all ten tasks with 4,879 tests and three existing skips in 2m20.803s. The subsequent `corepack yarn build:desktop --force` passed all three tasks without cache reuse in 23.985 seconds. The forced build is repeated after final documentation formatting so it remains the last software verification.

Logs are retained in `/tmp/cafe-provider-sept28-checks.ATGibc`. The tested runtime/test/generator diff against the base is saved there as `tested-code.patch`, SHA-256 `0fadc9aa8eb6c96d81d14b0ae959923e29ec58d6352b83cbba800b7db057afc6`; this excludes documentation and the unrelated untracked mockups. No setup or dependency changed, so the existing locked setup was reused rather than claiming a fresh installation. Native Windows runtime, live paid-provider and 16-hour production qualification remain outside this fixture-based audit.
