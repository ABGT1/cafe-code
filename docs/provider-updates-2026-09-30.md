# Codex 0.159.1 model-catalog compatibility

Created: 2026-09-30 08:55:57 JST (UTC+0900)
Last updated: 2026-09-30 15:22:42 JST (UTC+0900)
Status: implemented and verified for publication.

## Runtime and immutable upstream evidence

At the initial audit, the configured system Codex command reported `codex-cli 0.159.1`; its npm wrapper and macOS ARM64 native sibling had the matching version. The public npm latest manifest also reported 0.159.1. No reinstall, credential modification, paid model request, or active-session restart was needed or performed. Existing native processes are not hot-upgraded by changing Cafe source or rebuilding its bundle. The later 0.159.2 observation is recorded below.

The [official changelog](https://learn.chatgpt.com/docs/changelog) describes GPT-6.1 Sol becoming the bundled and Bedrock catalog default. The annotated `rust-v0.159.1` tag resolves to commit `8e68a98ef03cdde76d2e6800791ebdf1b3b95b24`. Comparison with the prior release commit `687a119f0fcaace47e1f1abcc77cec6c813fd6da` finds 29 changed files. Production changes are the version, bundled model catalog, Bedrock catalogs and a Bedrock model ID constant; the remaining changes are tests and snapshots.

The complete app-server protocol tree is identical (`01988e423904843f6b005fa640750aa3cd7b97b6`), including the schema subtree (`93532610871f7bb0c9e2bc8aebb39224991550f7`). Keep the existing exact 0.159.0 generator pin: regenerating an unchanged protocol is unnecessary. No launcher, transport, lifecycle, approval or error-envelope adaptation is warranted.

## Cafe changes and model authority

Added GPT-6.1 Sol to the shared cold-start/custom-entry Codex catalog, retaining Astra's existing fallback order and all saved model choices. The immutable native catalog advertises Low as its default effort, Low through Ultra, text/image input, and optional Fast mode. Authenticated `model/list` responses remain authoritative: static fallbacks must not overwrite discovered availability or narrower Bedrock controls.

The API model page and native Codex catalog serve different clients. Do not substitute API effort defaults or its maximum context window for native Codex metadata. Native GPT-6.1 Sol has a 272,000 default context window and an 872,000 maximum; Cafe continues consuming runtime context reporting rather than introducing a new fixed budget. Native model/backend policy continues to own agent effort, service-tier defaults and compaction.

Added an exact GPT-6.1 Sol rate to `packages/shared/src/modelPricing.ts`, avoiding the generic GPT fallback. The [official model page](https://developers.openai.com/api/docs/models/gpt-6.1-sol) and [pricing table](https://developers.openai.com/api/docs/pricing) report standard USD per million tokens: 2 input, 0.10 cached input, 2.50 cache writes and 10 output. These remain standard-rate API estimates, not subscription-credit accounting or a reconstruction of per-request Fast/long-context pricing. User-entered rates still take precedence.

## Concurrency and token preservation

The full upstream configuration, core implementation and model-manager implementation trees are unchanged. Rechecked invariants: `agents.max_concurrent_threads_per_session` and its `max_threads` alias accept positive `usize` values and count spawned threads; Cafe's 1–64 bound is local policy. V1 defaults to six spawned children; V2 defaults to four total threads. Explicit V2 settings retain precedence; Cafe's explicit spawned ceiling N still requires its existing root-inclusive N+1 translation. Omission delegates to provider configuration. New native Sol selects V2; Bedrock normalization selects V1. Never infer backend choice from the slug alone.

There is no new cache/compaction implementation or existing-model context-policy change to enable. Preserve native session identity, bounded history resume, stable helper prompts and explicit Fast-off handling. Catalog/tool-description updates can change prompt bytes, so unchanged implementation does not promise unchanged cache-hit rates. The new model's lower cached-input price is a pricing difference, not a token-count reduction; no measured savings are claimed.

Security review: only trusted static metadata and standard-rate estimates change. No new provider calls, permissions, logs, transports, credentials or user-config writes are introduced. Existing strict live-model decoding and capability authority remain in place. No new ADR is needed because architecture and trust boundaries are unchanged.

## Verification and replay

Initial verification base: `2b2e3f89` on `dev`; Node 24.13.1, Corepack Yarn 4.17.1, macOS ARM64, existing locked dependencies. Publication is prepared on `184d7c48` after the user-requested fast-forward to the latest `dev`, with all local provider changes preserved. Focused synthetic tests cover cold-start/custom entries, live capability precedence, exact/snapshot pricing, user overrides and cached-token estimates. No live provider inference is needed.

Initial verification results (2026-09-30 09:02:47 JST (UTC+0900)):

- `corepack yarn fmt`, `corepack yarn lint` and `corepack yarn typecheck`: passed. Lint retains existing warnings.
- Focused CodexProvider, ProviderRegistry and modelPricing tests: 106 passed.
- `corepack yarn test --concurrency=2 -- --maxWorkers=2`: all ten tasks passed; 5,057 tests passed and three explicitly skipped. No live provider inference was performed.
- Independent review: no actionable findings in implementation, tests or documentation. Live capability precedence, preserved defaults and mixed-cache cost calculations were checked against immutable native source and official pricing.
- `corepack yarn build:desktop --force`: passed as the final software verification; all three tasks ran uncached and completed in 25.2 seconds.

Exact source comparison, verification logs, working-tree patch and changed-file SHA-256 manifest are retained locally in `/tmp/cafe-codex1591.F1MuNU`. No native cross-platform qualification, measured token savings or active-session upgrade is claimed.

## Codex 0.159.2 follow-up

Checked: 2026-09-30 10:20:13 JST (UTC+0900)

The installed CLI now reports `codex-cli 0.159.2`, with matching npm wrapper and macOS ARM64 native package. Public npm latest also resolves to 0.159.2; no installation or session restart was performed. The [official changelog](https://learn.chatgpt.com/docs/changelog) identifies this as a native process-launch bug-fix release. Platform-specific findings and safeguards are recorded in `AGENTS.md` under Windows-Specific Notes.

The annotated release tag `8b9fa496bbf2c47aebd62e85a080b9a522a455b5` resolves to immutable commit `ff6aec96948b70d94983af2641a6b67c94faeff5`. Exact comparison with 0.159.1 finds 47 changed files, but the full app-server protocol/schema trees retain the hashes recorded above. The complete model-manager tree (`24f7607c8e900d555c1db789b445c23a085f2afe`) is also identical. Concurrency configuration and agent implementations are unchanged; the reviewed patch does not alter cache, compaction, usage counters or pricing metadata.

No additional Cafe software changes, protocol regeneration, model migration or token-saving overrides are warranted. The previous GPT-6.1 Sol additions remain necessary and unchanged. SHA-256 comparison of all five previously changed software/test files matched the already-tested 09:02 source state. The full test suite and forced desktop build above belong to that earlier implementation pass and were not rerun during the documentation-only follow-up at 10:20. No credentials, user settings, permissions or provider sessions were modified.

## Publication verification

Started: 2026-09-30 15:17:25 JST (UTC+0900)

The user authorized committing and pushing all outstanding changes. The publish set contains the five provider/model-pricing software and test files, `AGENTS.md`, and this audit. The earlier UI update is already in the remote branch. Ignored plans, explorations and local evidence remain private.

Completed: 2026-09-30 15:22:42 JST (UTC+0900)

Independent review found no code or test blockers. Verification against base `184d7c48` plus this publish set passed:

- `corepack yarn fmt`, `corepack yarn lint`, and `corepack yarn typecheck`: passed; lint retains existing warnings.
- `corepack yarn test --concurrency=2 -- --maxWorkers=2`: all ten tasks passed; 5,057 tests passed and three explicitly skipped.
- `corepack yarn workspace @cafecode/web test:browser src/components/StatusAnimations.browser.tsx src/components/virtualDesktop/VirtualDesktops.browser.tsx`: 48 tests passed, covering the incoming desktop-dialog and animation changes.
- `corepack yarn build:desktop --force`: all three tasks ran uncached and passed in 24.3 seconds as the final software verification.

Verification logs are retained in `/tmp/cafe-dev-publish.kPnNfy`. No additional software changes followed the forced build. The source diff and changed-file hashes are recorded alongside the logs before commit.
