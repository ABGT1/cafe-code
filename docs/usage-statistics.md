# Usage statistics

Last updated: 2026-10-01 21:05:47 JST (UTC+0900)

Settings → Usage has one date-range selector for the entire dashboard. The default is 30 days. Selecting 7 days, 30 days, 90 days or All updates generated tokens, chats sent, generating time, estimated USD cost, provider/model breakdowns, token composition, cache savings, cost quality, charts and activity together. Cost/Tokens changes the graph's measurement without changing the selected period. The shared detailed cost view in Atrium uses the same range semantics; Atrium's ambient lifetime counters remain lifetime counters.

## Calendar and data boundaries

A finite period includes the server's current local day and the preceding N−1 calendar days. It is anchored to `today.day` in the detailed usage response, not the browser's timezone. Quiet days count toward the range and appear as zero activity. All includes all recorded history, including authoritative lifetime counters whose older daily or model detail may be unavailable.

`apps/web/src/components/stats/usageRange.ts` derives the selected view from the existing decoded usage response. It independently sums generating time, chats, input/output and cache/reasoning counters, then aggregates only model observations within the same daily bounds. Cache reads and writes are subsets of input; reasoning is a subset of output and is never added again to processed tokens. Range changes reset numeric animations and generation-time floors so values from a larger period cannot briefly masquerade as a smaller period's usage. Activity uses the same calendar bounds and can scroll through full history within its panel.

The existing primary-environment shared detail resource single-flights one refresh every five seconds while visible consumers exist, and refreshes after transport reconnection. Counted dashboard figures derive from the same detailed response, including its provider/model observations. The aggregate live stream supplies current generation status, not guessed model/day attribution; generation time can advance between detailed reads. A fresher detailed response takes precedence over a stale stream event. This feature adds no polling loop, provider calls, credentials, persistent renderer cache, database tables or API fields.

## Estimates and missing history

Long activity histories retain their complete scrollable extent while rendering only visible week columns plus a small overscan. This bounds page content even for an unusually old calendar, without imposing a historical date cutoff or hiding older records.

Money is an API-equivalent USD estimate using the shared pricing table or explicit user overrides, not a subscription invoice. Long-context and speed-tier adjustments cannot be reconstructed from aggregate counters and remain excluded. Unknown model rates and missing model attribution remain unpriced; the priced/unpriced percentages include the recorded unattributed gap. The output breakdown identifies unattributed usage separately.

Older servers may omit daily model attribution. Finite ranges still show their recorded aggregate counters, but cannot assign costs by borrowing lifetime model shares. Similarly, old history may contain output without input/cache/reasoning measurements. Missing dimensions are not fabricated or backfilled. All's lifetime total can exceed the daily graph when historical daily detail is unavailable; the graph remains a daily-ledger view rather than inventing dates or rates for that difference. Interrupted requests may not report complete usage, so cost-quality percentages cover recorded counters only.

## Verification and replay

Use the repository-pinned Node and Corepack Yarn versions, existing lockfile and synthetic fixtures. No authenticated provider is needed:

```sh
corepack yarn workspace @cafecode/web test src/components/stats/usageRange.test.ts
corepack yarn workspace @cafecode/web test:browser src/components/settings/UsageStatsPanel.browser.tsx src/components/stats/ActivityHeatmap.browser.tsx
corepack yarn fmt
corepack yarn lint
corepack yarn typecheck
corepack yarn test
corepack yarn build:desktop --force
```

The focused checks exercise inclusive date boundaries, sparse calendars, absent attribution, historical lifetime gaps, range-wide UI changes and responsive layouts. Run the forced desktop build after the tests as the final software verification step. Public usage diagnostics retain numeric/account-aggregated metadata only; this presentation change does not introduce prompt, output or account-identity logging.
