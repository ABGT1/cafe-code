# Global dictation: Mac panel, explicit draft actions, and verified target insertion

**Decision status:** Accepted; partially superseded by [guarded paste for web fields](global-dictation-guarded-paste.md) and [reviewed custom writing styles](global-dictation-custom-styles.md).

**Created:** 2026-09-24 16:10:20 JST (UTC+0900)

**Latest revision:** 2026-09-27 21:19:26 JST (UTC+0900)

**Decision authority:** The user authorized the complete Mac-only design, including the editable draft and Copy, Save, and Insert. Component boundaries and security mechanisms are implementation choices within that authorization.

**Implementation status:** Implemented; repository formatting, lint, typecheck and tests pass. Interactive packaged macOS qualification remains separate from these checks; no universal cross-app insertion support is claimed.

**Supersedes:** None.

**Superseded by:** [Global dictation: guarded paste into captured web fields](global-dictation-guarded-paste.md), limited to the original prohibition on clipboard paste and synthesized paste keys; [reviewed custom writing styles](global-dictation-custom-styles.md), limited to the finite built-in style vocabulary and Formal-only rewriting. Other original decisions remain in force.

## Context

Cafe already has opt-in, transcription-only Realtime dictation inside its chat composer. That text controller owns a composer range and must not be reused for another application's text field. A system-wide shortcut needs an Electron-main owner, a capture window that remains alive when the main window closes, and a way to return text to the app and field that were active before a focusable review window appeared. A writing-style preview must preserve a user's edits and make optional AI text processing a separate privacy and cost decision.

The user's initial macOS shortcut is ⌘⇧,; Windows and Linux equivalents require independent platform work. macOS Accessibility metadata varies by app, and an external text field does not provide Cafe with an exactly-once transaction acknowledgement.

The transport follows OpenAI's [Realtime transcription guidance](https://developers.openai.com/api/docs/guides/realtime-transcription): completed transcription is authoritative after the audio item is committed, while live deltas are provisional. Formal follows the separate [Responses text generation API](https://developers.openai.com/api/docs/guides/text). These upstream interfaces do not confer any authority to insert into another application's field.

## Alternatives and rationale

- Directly type on stopping the microphone: rejected because the user cannot edit, check recognition, or safely choose a destination before another app receives text.
- Reuse the main Cafe window/composer range: rejected because closing the main window or switching threads would make global capture fragile, and a composer text range has no authority over an external target.
- Paste through the clipboard or synthesize keys into the current focus: rejected because focus can change during preview, clipboard mutation is visible to other software, and the target cannot be reliably bound to the captured field.
- Let the renderer issue arbitrary Accessibility or keyboard commands: rejected because web content should not gain a general cross-application automation surface.
- Ask the speech recognizer to guarantee lowercase, punctuation removal, or formal prose: rejected because recognition hints do not provide exact formatting. Deterministic styles belong in the preview; Formal is a separate, consented text request.

## Decision

The macOS desktop app owns a default-off global shortcut and one global dictation session at a time. Pressing the shortcut captures the frontmost editable target before a dedicated, trusted Electron panel appears. That panel first shows a passive recording card without taking focus. A second press commits the audio once, waits for the authoritative completed transcript, and makes the panel focusable for review. Partial words are display-only. Composer dictation and global dictation share a single microphone ownership rule.

The review panel owns an immutable final transcript and an editable draft. Local lowercase and punctuation transformations derive from the original and require explicit confirmation before replacing manual edits. Copy, Save text…, and Insert are separate, visible actions. Save is an explicit user-selected UTF-8 file export, not a hidden transcript store or a style preset. Closing a nonempty draft requires confirmation. One-shot Command mode is deliberately armed in review and recognizes only exact style-selection or cancellation phrases; it never executes Insert, Copy, Save, or Reset.

Formal is a separately consented, authenticated, bounded text rewrite. The backend uses the existing stored OpenAI API key for a stateless Responses request with fixed model/instructions, no tools, no previous conversation, and sanitized failure messages. The renderer receives no permanent key. A stale rewrite must not replace a newer edit or session.

The Mac target helper is a narrow Electron-main-only child. It holds an in-memory snapshot of the exact frontmost application, window, Accessibility element, text/selection commitments, and a random single-session token. The token never enters a renderer. Insert begins from Cafe's review panel, reactivates the original app, revalidates the original writable, nonsecure field and compatible text/selection state, then attempts one selected-text write. The panel closes only after a verified success; unsupported, changed, denied, and uncertain outcomes preserve the draft. An uncertain write is never replayed automatically. There is no generic `sendKeys` IPC, clipboard paste fallback, or Enter/form submission.

The dedicated panel is an auxiliary window, not the main Cafe window. It receives microphone permission only at its exact trusted origin and top-level `webContents`, alongside the existing composer window. Camera, frames, foreign origins, and unrelated permissions remain denied. Its visual treatment may use native macOS vibrancy with an opaque reduced-transparency fallback; a permanent non-focusable panel would prevent draft editing.

## Security, privacy, and failure consequences

The permanent API key remains server-side, and the WebRTC peer uses only a short-lived transcription-scoped credential. Audio and text do not enter debug payloads, process arguments, URLs, or logs. The native helper uses a private stdin/stdout protocol, no shell, and a fixed packaged executable; target details and token stay in memory. Bounded request sizes, exact sender/session checks, and generation fencing prevent stale renderer messages or completions from acting on another recording. Explicit Quit, cancel, renderer loss, sleep/lock, permission failure, and transport failure must retire microphone and native helper resources.

Formal introduces a distinct transcript-to-backend/OpenAI boundary. It requires a user-visible opt-in, an authenticated owner request over the primary local connection, a fixed style/model, bounded text and output, rate limits, `store: false`, `tools: []`, and `tool_choice: "none"`. Error and diagnostic surfaces use fixed classifications rather than provider response bodies. Local styles, Copy, Save, and native insertion do not call this rewrite endpoint.

Accessibility cannot guarantee universal app support or prove that a successful API call caused another app to persist the text. The fail-closed outcome keeps the draft for manual Copy/Save. Secure and unverifiable controls are rejected. An ambiguous acknowledgement must be shown as uncertain, not silently retried.

## Compatibility and operational consequences

The existing composer transcription protocol, secret storage, and browser client remain in place. The global panel is a macOS desktop capability, disabled until the user enables it. Windows and Linux have no global shortcut, native insertion, or implied permission model in this decision. A packaged Mac build needs the compiled native helper and microphone usage description; macOS Microphone and Accessibility permissions are independent. Shortcut registration can conflict with the OS or another app and must produce a visible status rather than silently fail. Keyboard layouts, Spaces, full screen, multiple displays, reduced transparency, and custom editors require hands-on qualification.

The native helper is compiled with the macOS toolchain from repository source. No alternate JavaScript runtime, external speech provider, transcript database, or launch-at-login behavior is introduced. No migration of existing chat transcripts is required.

## Implementation and evidence impact

The source boundaries are the desktop shortcut/coordinator and settings, trusted panel and microphone policy, macOS Accessibility helper, global renderer/controller, existing Realtime transport, and authenticated Formal RPC. [Global dictation help](../global-dictation.md) describes user-visible behavior. The repository gates are formatting, lint, typecheck, tests, and the final forced desktop build. Focused unit and browser tests cover state, styles, stale results, exact IPC sender and target denial; opt-in packaged Mac tests must separately verify actual focus, permissions, target insertion, keyboard layouts, and window management. A passing build or mocked helper test is not evidence of cross-app insertion in every macOS app.

## Supersession and preserved decisions

This decision extends `AGENTS.md` §OpenAI Realtime Dictation and preserves its transcription-only credential, debug redaction, composer text-range, and explicit Send rules. It does not supersede an earlier ADR. Provider runtime and desktop-control permissions remain unrelated.
