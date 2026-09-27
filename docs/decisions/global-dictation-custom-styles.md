# Global dictation: reviewed custom writing-style instructions

**Decision status:** Accepted.

**Created:** 2026-09-24 21:05:38 JST (UTC+0900)

**Latest revision:** 2026-09-27 21:19:26 JST (UTC+0900)

**Decision authority:** The user requested their own writing style through voice commands. The bounded candidate, review, consent and request design are implementation choices within that authorization.

**Implementation status:** Implemented; focused contract/service/parser/browser checks and owner-only RPC integration passed during implementation. Full repository formatting, lint, typecheck and tests passed again before commit. No live paid rewrite was performed as a test. Applying the implementation requires a rebuilt desktop bundle and app restart.

**Supersedes:** [The original global-dictation decision](global-dictation.md), only its finite built-in style vocabulary and Formal-only rewrite restriction.

**Superseded by:** None.

## Context and alternatives

Built-in lowercase and punctuation controls cannot express every preferred tone or structure. The user wants to describe a writing style aloud. Executing arbitrary voice instructions immediately would blur the boundary between draft editing and actions in another app. Sending every command transcript to a general agent would also add unnecessary cost and authority.

A reviewed style candidate is sufficient: retain deterministic built-in phrases, and accept an anchored `style <instructions>` phrase as inert editable text. This adds flexibility without voice-controlled external actions. Persistent presets and general voice automation are not part of this change.

## Decision

The review panel offers a Custom style control with a bounded editable instruction field. The deliberately armed, one-shot Command microphone can populate that field from a completed `style <instructions>` transcript. It never interprets ordinary dictation or partial transcription. A custom voice candidate does not change the draft or start an API request.

The user chooses Apply custom style, confirms replacement of manual draft edits when necessary, and separately consents to sending the immutable original transcript and style instructions to OpenAI. Prior Formal consent does not cover a custom instruction request. The candidate approved by this click is immutable for that request. Changes to instructions, draft, style or session invalidate late responses. Local styles remain local, and the original remains recoverable.

The existing owner-authenticated, primary-local rewrite RPC accepts a discriminated Formal or Custom request. Custom instructions are bounded by `DICTATION_REWRITE_INSTRUCTIONS_MAX_CHARS` in the shared schema, separately from transcript/output limits. A fixed server prompt restricts custom preferences to editorial changes; serialized user input separates the dictated text and writing preferences. User text never becomes high-priority server instructions or request configuration. The existing fixed model, no-tools request, `store: false`, output limits, single-request admission, rate limits and sanitized failures remain unchanged. See [OpenAI's instruction-role guidance](https://developers.openai.com/api/docs/guides/text) and [Responses storage controls](https://developers.openai.com/api/docs/guides/migrate-to-responses).

## Security, privacy and failure consequences

Custom instructions cross the same explicitly consented privacy/cost boundary as the transcript. Neither input, output nor command transcript belongs in logs, spans, debug snapshots, process arguments or hidden persistence. Credentials remain in the server secret store. Schema decoding is repeated inside the service; paired non-owner requests remain unauthorized. Instruction text cannot select a model, endpoint, tool, conversation or output budget.

Prompting does not prove that a model will preserve every nuance. Results remain editable previews requiring deliberate Copy, Save, Insert or Paste. The feature cannot execute, paste or submit anything from spoken instructions. An upstream failure preserves the existing draft, and an ambiguous paid request is never retried automatically.

## Compatibility and evidence

Existing Formal requests retain their wire shape and behavior. Custom requests require an updated server; older servers reject them rather than interpreting them as another action. There is no settings migration, new credential, dependency or platform support. Windows/Linux global dictation remains deferred.

Contract and service tests cover bounds, consent, isolated input, unchanged tool/model/storage controls, shared rate admission and sanitized errors. Parser/browser checks cover inert spoken candidates, explicit custom consent, immutable originals, manual-edit preservation, stale results, manually stopped command finalization and compact layout. RPC integration verifies owner-only forwarding with no paid request. The mandatory final desktop build remains a release gate. Live model style quality, microphone accuracy and the broader native target matrix remain separately qualified.

## Preserved decisions

The [original decision](global-dictation.md) remains the authority for capture, target binding, transcript privacy and deliberate external actions. The [guarded-paste successor](global-dictation-guarded-paste.md) remains unchanged by custom styles. This amendment does not permit spoken Insert, Paste, Copy, Save, Reset, Enter, arbitrary keyboard IPC or automatic retries.
