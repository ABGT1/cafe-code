# Global dictation: guarded paste into captured web fields

**Decision status:** Accepted by explicit user authorization of guarded paste for Chromium fields.

**Created:** 2026-09-24 20:23:40 JST (UTC+0900)

**Latest revision:** 2026-09-27 21:19:26 JST (UTC+0900)

**Decision authority:** The user explicitly approved a guarded paste fallback after the selected-text Accessibility path proved insufficient for Chromium web fields. This authorizes the fixed, visible Paste into app action described here, not general keyboard or clipboard automation.

**Implementation status:** Implemented; repository formatting, lint, typecheck and tests pass. Native editor, focus and clipboard qualification remains separate; a passing build or mocked test does not prove universal target support.

**Supersedes:** [Global dictation: Mac panel, explicit draft actions, and verified target insertion](global-dictation.md), only its prohibition on clipboard paste and synthesized paste keys.

**Superseded by:** None.

## Context

The original decision permits one verified Accessibility selected-text write to the exact field captured before review. Chromium web editors can expose a readable field and selection while selected-text writes do not reliably update the editor. Using the editor's own paste handling can preserve its normal input behavior, but introduces a clipboard privacy boundary and an asynchronous keyboard-event boundary.

The user approved this additional mechanism explicitly. An accepted design does not establish support for every browser, Electron app, custom editor or Accessibility implementation.

## Alternatives and rationale

- Keep Copy and Save as the only fallback: remains available for unsupported or changed targets, but does not meet the approved request for insertion into qualified web fields.
- Silently paste after a failed AX write: rejected because an uncertain first write may already have changed the field, and the user would not have authorized the clipboard side effect.
- Post Command-V to whatever is focused: rejected because review changes focus and a third app or another field can become active during handoff.
- Restore the old clipboard immediately after posting Command-V: rejected because event dispatch does not prove the destination consumed the draft. A delayed paste could insert the restored old contents instead.
- Expose general key or clipboard-read methods to the renderer: rejected because the product needs one bounded native operation, not a cross-app automation interface.

## Decision

The native helper chooses an immutable insertion method at capture. A bounded parent walk that finds an AX web area within the original process selects `paste`; supported native fields retain `accessibility` selected-text insertion. The renderer receives only this fixed method, never a target identity, helper token or clipboard contents. Its explicit primary action is **Paste into app** for paste mode and **Insert** for Accessibility mode. Paste mode visibly warns that clipboard history or other apps may observe the draft and that uncertain delivery may leave it on the clipboard.

Both methods consume one-shot authority before external I/O. The desktop hides the review panel, and the native helper verifies the exact retained process, window and nonsecure editable field plus unchanged complete text and selection. Focus may return only to that retained field. Live focus checks must refuse a third app taking over, and the field is revalidated immediately before dispatch. There is no fallback from an attempted AX write to paste in the same recording.

A paste replacement that would leave the exact field contents unchanged completes without clipboard mutation or key dispatch. Otherwise an already-matching value could falsely acknowledge a queued paste, permitting old clipboard restoration before the destination reads the draft. Expected-value verification uses exact text equality rather than Unicode canonical equivalence.

The paste operation follows this fixed sequence:

1. Snapshot every representation of every clipboard item in native memory. Enforce the item, representation and total materialized-byte limits in [the native helper](../../apps/desktop/native/mac-dictation-target.swift). Reject file promises, other promised or unreadable data, an oversized snapshot, or a `changeCount` change during capture before changing the clipboard.
2. Revalidate the original field and publish only the draft, a random private ownership marker, and transient/concealed clipboard hints. The hints are advisory; they do not establish confidentiality.
3. Recheck clipboard ownership and the exact original target, then post exactly one Command-V key-down/key-up sequence to the captured process. Never post Enter, submit a form, or accept renderer-selected keys, modifiers or process IDs.
4. Verify that the exact field value becomes the expected result of replacing the captured selection with the draft. A successful event-post call alone does not prove insertion.
5. Restore every saved clipboard representation only if no key dispatch occurred, or if expected-field-text verification establishes that the target consumed the draft. Restoration additionally requires both Cafe's random ownership marker and the matching temporary-write `changeCount`; newer clipboard ownership takes precedence.
6. If dispatch happened but the final field cannot be verified, report `insertion_uncertain`, retain the review draft, and never retry. Do not restore old clipboard contents into a still-pending paste. The draft may remain on the clipboard unless another owner has replaced it.

Failure to snapshot or prepare the clipboard before dispatch returns the fixed `clipboard_unavailable` category. The field and draft remain available for manual Copy or Save. A failure after possible dispatch must retain uncertainty rather than claim that nothing was inserted.

## Security, privacy, and failure consequences

The clipboard is shared OS state. Other software, clipboard history, synchronization services or the destination app can observe temporary text even if restoration succeeds. Cafe must disclose that consequence before the explicit paste action. Clipboard snapshots, all representations, ownership markers, target identities, private capability tokens and draft contents stay in native memory and never enter renderer clipboard-read APIs, process arguments, URLs, logs or diagnostic payloads. Cleanup is best effort: process termination, clipboard ownership changes and uncertain dispatch prevent a guarantee that the previous clipboard will be restored.

The trusted panel's exact sender, main frame, session, generation, bounded text and native-selected method remain required at IPC admission. No generic `sendKeys`, AX operation or clipboard-read channel is introduced. The helper remains a fixed, nonsymlinked, shell-free child communicating over its private pipe. The fixed paste sequence does not authorize arbitrary keyboard automation.

Pending startup authority exists before a panel becomes active. Disable, lock, suspend, Quit and disposal invalidate its generation, stop its pending helper and destroy its pending hidden window. Completion after either native capture or renderer trust setup cannot revive the cancelled recording, and an old completion cannot release a newer startup gate. Old insertion outcomes cannot overwrite a later capture's diagnostics or reopen a retired panel.

Debug output retains only fixed capture/insertion outcomes, canonical timestamps and finite bounded durations alongside the existing shortcut/panel facts. Both compact and full snapshots independently validate this allowlist; no target, draft or clipboard content is included. `not_attempted`, `succeeded`, `clipboard_unavailable`, and the existing fixed failure categories distinguish lifecycle and refusal outcomes without exposing private data.

## Compatibility and operational consequences

The review starts at 490 × 510 DIP, constrained to the available display, and remains resizable. Its draft and primary actions must remain usable at that size. The additional paste label and privacy disclosure must fit this compact layout.

This is an extension of the existing macOS native insertion boundary. Native selected-text insertion, the independent composer microphone, the Realtime credential boundary, local styles, Formal consent and explicit Copy/Save remain intact. No persisted transcript store, new provider, alternate JavaScript runtime or general automation dependency is added.

The native helper is the canonical definition of clipboard resource limits and web-field recognition. Keep its bounded same-process ancestry checks and clipboard snapshot policy under review when qualifying a new editor; a readable Accessibility field alone is not evidence of safe paste support.

## Implementation and evidence impact

Affected components are the Swift target helper, its typed desktop client, the coordinator and shared event/action contracts, the review renderer and user-facing failure guidance. [The user guide](../global-dictation.md) and `AGENTS.md` document the current contract. Required repository verification remains formatting, lint, typecheck, tests, and a final forced desktop build.

Focused tests must cover immutable native-selected method admission, one-shot behavior, changed target refusal, pending-startup cancellation, stale diagnostics and safe user-facing failure categories. Native qualification must separately exercise a controlled Chromium text field and native field, changed app/window/field/text/selection, rich clipboard preservation, unreadable or oversized clipboard refusal, clipboard replacement by another owner, verified paste restoration, and uncertain delivery without retry or premature restoration. Tests must use synthetic text and clipboard data, not inspect unrelated user applications or clipboard contents. Actual cross-app support and timing remain limited to the platforms and editors exercised; a passing mocked test or build does not prove universal support.

## Supersession and preserved decisions

This decision replaces only the predecessor's blanket rejection of clipboard paste and synthetic paste keys, with the explicitly authorized fixed operation above. The original rationale remains historically accurate and still prohibits pasting into arbitrary current focus, silent clipboard side effects, generic renderer automation, form submission and uncertain retries. Every other requirement in [the original decision](global-dictation.md) remains in force.
