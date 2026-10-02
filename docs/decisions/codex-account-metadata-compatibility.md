# Codex account-plan compatibility without relaxing account validation

Decision status: accepted
Created: 2026-09-29 18:40:20 JST (UTC+0900)
Latest revision: 2026-09-29 19:01:18 JST (UTC+0900)
Decision authority: implementation discretion within the user's authorization to fix the Codex compatibility and subscription-readiness audit findings.
Implementation status: implemented and verified; repository checks, browser regressions and final forced desktop build passed.
Supersedes: none.

## Context and alternatives

Codex publishes a closed plan enum, but subscriptions can roll out before Cafe regenerates its protocol. Rejecting an otherwise valid account or quota response because its plan identifier is new discards useful usage data. Replacing generated schemas with permissive objects would also discard the validation protecting authentication and usage boundaries. Hand-editing generated enums is neither forward-compatible nor reproducible.

## Decision

Keep the generated release schemas exact. A separate, shared compatibility module maps unfamiliar, bounded identifier-shaped plan strings to the existing `unknown` sentinel at the documented account-plan locations only. The ordinary generated decoder then validates the entire payload. Missing required data, malformed identifiers, invalid authentication modes and malformed numeric quota fields continue to fail. Known plans retain their exact values and the subscription formatter remains exhaustive against the release enum.

Apply the same adaptation to typed response decoding, typed and raw incoming notifications, and the server adapter/rolling quota decoder so persisted older events do not depend on having passed through the current client. Do not recursively rewrite arbitrary fields, normalize unrelated methods, or infer authentication, entitlement, price or a quota multiplier from a plan string.

## Security and compatibility consequences

- API-key, Bedrock, logged-out and unrecognized authentication variants keep their existing validation and account authority.
- Unknown plan identifiers are not displayed as subscription names. Decoded notification projections remove undeclared fields before persistence.
- Bucket identifiers remain inert object keys and escaped UI text. Construct copied maps without prototype setters.
- New quota/model-alias metadata is optional; old snapshots still decode. Presentation remains read-only and adds no provider calls or credit-redemption path.
- There is no change to prompts, permissions, credentials, model selection, native session identity or lifecycle/retry ownership.

## Implementation and evidence

The implementation is in `packages/effect-codex-app-server/src/compatibility.ts`, the client decode boundary, and the server Codex account/quota mapping paths. Unit and in-memory protocol fixtures cover known/future/malformed plans, both notification paths, named buckets, immutability and prototype-shaped bucket keys. Adapter fixtures cover replay and rejection of invalid non-plan fields. See [the release audit](../provider-updates-2026-09-29.md) for final verification and replay evidence. No live account or paid model request is required for these checks.

This supplements the existing generated-schema and account-identity rules; it does not supersede any lifecycle, approval, reset-credit or authenticated transport decision. The upstream account locations are documented in the [official app-server reference](https://learn.chatgpt.com/docs/app-server#auth-endpoints).
