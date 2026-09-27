# Global dictation on macOS

Last updated: 2026-09-24 21:21:39 JST (UTC+0900)

Global dictation lets you speak into a draft while working in another app. Cafe shows the recognized text in a floating review window. You can edit it and then choose **Copy**, **Save text…**, or the target's **Insert** / **Paste into app** action. Stopping the microphone does not send a chat message, submit a form, or type into another app.

This feature is for the macOS desktop app. The in-composer microphone remains available for Cafe conversations. Windows, Linux, and browser clients do not have a system-wide shortcut or cross-app insertion in this release.

## Set up and use

1. Configure your OpenAI Realtime dictation API key in Cafe's Dictation settings. The key must belong to an API project with Realtime transcription access and usable API credits.
2. Turn on **Global dictation** in the macOS desktop settings. It starts off. The default shortcut is **⌘⇧,** (Command–Shift–Comma); you can change it if another app or macOS owns that combination. Cafe reports a registration conflict instead of pretending the shortcut is active.
3. Put the caret in the text field where you intend to insert your words, then press the shortcut. Cafe captures the original app, window, text field, and selection before showing a small recording card. Allow microphone access when macOS asks.
4. Speak, then press the shortcut again or choose **Stop & review**. Cafe waits for the final transcription and opens an editable draft in a compact 490 × 510 device-independent-pixel review window, constrained to the available display. Words shown during recording are a live preview and are never inserted as a partial result.
5. Review and edit the draft. Choose **Insert** for a supported native field or **Paste into app** for a supported web field. Paste into app displays a clipboard privacy notice before you use it. You can instead choose **Copy** to copy the draft or **Save text…** to choose a UTF-8 text file. Cafe does not save a hidden transcript history.

Copy and Save leave the review draft open, but release the captured insertion target; Insert or Paste into app is then unavailable for that recording. You can keep editing or copy/save again. Cancelling the Save picker makes no change.

**Insert** and **Paste into app** require macOS Accessibility permission for Cafe and a supported, still-unchanged target. Either action briefly hides the review panel so Cafe can return focus to the exact original app, window, and field. Cafe restores that field's focus only after verifying that its identity, text, and selection are unchanged, then rechecks the target before one insertion attempt. Editing the dictation draft does not itself invalidate the original target. If the target has changed or cannot be verified, the review returns with the draft available for Copy or Save. Password fields and unverified custom editors are not automatic insertion targets. An uncertain external write is not retried automatically, because another app cannot provide a transactional acknowledgement to Cafe. The draft is never pasted into merely whichever field is currently focused.

Cafe chooses the action from the captured field. **Insert** uses the field's native Accessibility text operation. **Paste into app** supports qualified web fields, including Chromium editors, by temporarily placing the draft on the clipboard and sending one Command-V to the verified original app. It never presses Enter. A failed Insert does not silently switch to paste.

If you close a review draft, Cafe asks before discarding it. Disabling the feature, locking or suspending your Mac, or quitting Cafe also cancels pending startup, so a delayed capture or window-load result cannot start the microphone later. The feature does not turn on launch at login.

## Writing styles and voice control

The preview offers **As transcribed**, **lowercase**, **no punctuation**, and **lowercase + no punctuation**. These are local, mechanical transformations of the original transcript. They do not send an additional writing request to OpenAI. Removing punctuation can change a URL, decimal, contraction, or source code, so inspect the result before Insert. **Original / reset** returns to the unchanged final transcript. If you edited the draft, a style change asks whether to keep your edits or replace the draft from the original.

**Formal** is an optional, separate rewrite. The first use in the review window explains that the original transcript will be sent through Cafe's authenticated backend to OpenAI and may consume additional API credits. It runs only after you choose **Allow & rewrite**. The resulting draft remains editable, and you can compare it with the original before any action. A failed rewrite leaves the existing draft available. It is a text rewrite, not a speech recognition setting or a guarantee about transcription punctuation.

The **Command** control arms a separate, short, one-shot microphone capture for style selection. Say an exact phrase such as “style lowercase”, “style no punctuation”, “style formal”, or “cancel command”. Normal dictated speech and live transcription previews are never parsed as commands. Unknown speech changes nothing. Voice commands cannot Insert, Paste, Copy, Save, or reset the draft. A voice-selected style also cannot silently overwrite manual edits.
The command microphone stops automatically after a short bounded interval if you do not stop it sooner.

For your own style, choose **Custom** and type instructions, or tap **Command** and say, for example, “style friendly and concise, with short paragraphs”. The spoken description fills **Custom style instructions** without changing your draft or calling the rewrite service. Edit it if needed, choose **Apply custom style**, then **Allow & rewrite**. This sends the original transcript and your style instructions to OpenAI and may use additional API credits. Custom instructions are limited to 2,000 characters. Manual edits are not replaced without confirmation, and the result remains an editable preview. Instructions stay in memory for this review; they are not saved as a preset.

## Privacy and permissions

Audio goes directly from the trusted Cafe capture window to OpenAI's Realtime transcription service using a short-lived transcription-only credential. The permanent API key stays in Cafe's private server secret store. Local writing styles stay on your Mac. Formal sends only the bounded original text you authorize; Custom also sends your approved style instructions. Both use Cafe's authenticated backend and a separate, stateless OpenAI text request without tools or chat history. Copy changes the clipboard when chosen, Save writes only to the location you choose, and both insertion actions write only after the original target is verified.

**Paste into app uses the system clipboard. Clipboard history or other apps may retain the draft.** Before changing it, Cafe saves all available clipboard formats within a fixed size limit; it refuses the action if those contents cannot be safely preserved. After verified paste, Cafe attempts to restore the previous clipboard only if nothing else has changed its ownership. It preserves a newer copy made by you or another app. If paste was dispatched but its result is uncertain, Cafe leaves the draft on the clipboard instead of restoring old content that a delayed paste might insert. A crash can also prevent restoration. Inspect the original field before pasting again; restoration cannot erase copies already observed by other software.

Cafe does not persist audio, dictation drafts, voice-command transcripts, or the captured target. It does not include them in diagnostic logs. The native macOS helper keeps the target identity in memory while the review window is open, and the helper receives an Insert request through a private pipe rather than process arguments or environment variables. Microphone and Accessibility are separate macOS permissions. If either is denied, Cafe should explain the affected action and retain any available draft; no permission prompt should appear merely from leaving Global dictation off.

For source builds the helper is compiled under `apps/desktop/native/build/<architecture>/mac-dictation-target`; packaged Mac builds carry it at `Contents/Resources/mac-dictation-target`. Cafe selects only these fixed paths, never a file supplied by a renderer or setting.

## When an action does not work

- **Cafe disappears from the Dock after global dictation:** an older panel setup changed the entire app's macOS activation policy when enabling fullscreen visibility. Current builds keep Cafe in the Dock through recording, review and panel closure. Rebuild and fully relaunch an older running build to apply the fix; no Dock preferences or permissions need changing.
- **Shortcut unavailable:** choose another shortcut in Dictation settings. macOS or another app may have registered it first.
- **Shortcut says Ready but nothing appears:** when Cafe is launched with `--cafe-debug`, open its printed local `/debug` URL and check `globalDictationShortcut`. `registered` and `electronRegistered` show whether Cafe owns the accelerator; `invocationCount` changes when Electron receives it; `lastToggleOutcome`, `panelLoadOutcome`, `panelReady`, and `panelVisible` distinguish an ignored callback from a panel that failed to appear. These fields contain no transcript or original-target details. If the panel never completes its ready handshake, Cafe closes that invisible attempt after a short timeout and shows a fixed notice. Try a different shortcut in Settings if registration succeeds but callback delivery remains absent on your keyboard layout.
- **Window loads but readiness times out on an older build:** an earlier renderer startup loaded the ordinary app's theme service into the restricted dictation window and crashed before it could become visible. Rebuild and fully relaunch Cafe to apply the fix; the dictation window does not need additional desktop permissions.
- **Microphone unavailable:** check macOS Privacy & Security → Microphone for Cafe, then try again. A permission or connection failure must end the recording state rather than leave the microphone active.
- **Connection takes too long:** Cafe stops waiting for a stalled local backend and opens the review with a fixed error. Nothing is inserted automatically; close the review and try again after the backend is available.
- **Insert or Paste into app unavailable or rejected:** check macOS Privacy & Security → Accessibility for Cafe. Reviewing or editing the dictation draft focuses Cafe; the action handles that handoff by hiding the panel and restoring the original field only while its identity, text, and selection still match the capture. You do not need to switch back manually first. If the original field changed, closed, or cannot be verified, use Copy or Save from the restored review. Cafe does not insert into password fields or inaccessible controls.
- **Clipboard unavailable:** Cafe could not preserve the existing clipboard contents safely, or another app changed them while Cafe was preparing the paste. Nothing was pasted. Use Copy or Save from the review; Copy deliberately replaces the clipboard with your draft.
- **Paste result uncertain:** check the original field before doing anything that could duplicate the draft. Cafe will not retry automatically, and the draft may remain on the clipboard so a delayed paste cannot read unrelated old content.
- **An empty editor receives the draft but the panel returns:** the current helper recognizes Chromium's empty-paragraph placeholder, which disappears on paste. Older helpers mistakenly expected it to remain as a trailing newline. A verified paste now closes the panel. Editors whose Accessibility value collapses actual blank paragraphs can still report uncertainty; Cafe does not hide that mismatch or repeat the paste.
- **Diagnosing an insertion failure:** with `--cafe-debug`, `globalDictationShortcut.lastCaptureOutcome` and `lastInsertOutcome` report fixed result codes; the corresponding `lastCaptureAt` / `lastInsertAt` and `lastCaptureDurationMs` / `lastInsertDurationMs` report bounded timing information. `not_attempted` means that operation has not run, and `succeeded` means it completed. `accessibility_permission_required` identifies the missing permission; `target_changed`, `target_unavailable`, and `target_unsupported` identify a refused target; `helper_unavailable` and `helper_protocol_error` identify a helper failure; `invalid_text` identifies a rejected draft; `clipboard_unavailable` identifies refusal before paste dispatch. `insertion_uncertain` means an external write may have happened: inspect the destination before manually pasting to avoid duplicates. Old results cannot overwrite a newer recording's diagnostics. These diagnostics expose no draft, selected text, target identifier, app/window title, path, native error text, or clipboard contents.
- **Formal unavailable:** confirm the separate consent and the OpenAI API project's access and credits. The original and locally edited draft remain usable.

Actual shortcut behavior depends on keyboard layout and macOS registration; target support also depends on how each app exposes its text field to Accessibility. Interactive qualification should cover the apps and keyboard layouts you rely on. See [the original architecture decision](decisions/global-dictation.md), [the guarded-paste decision](decisions/global-dictation-guarded-paste.md), and [custom style instructions](decisions/global-dictation-custom-styles.md) for the trust boundaries and qualification limits.

## Opt-in native insertion check

On a Mac development checkout, build the native helper with `node apps/desktop/scripts/build-mac-dictation-helper.mjs --force`, then run:

```sh
env -u ELECTRON_RUN_AS_NODE corepack yarn workspace @cafecode/desktop exec electron scripts/smoke-dictation-insert.mjs --run-native-test --editor contenteditable --scenario success
```

This opens isolated synthetic editors, briefly takes focus, and exercises the real native helper. It does not start a microphone, provider, network session, or open your documents. It compares an in-memory fingerprint of the clipboard before and after the operation; clipboard contents, fingerprints, target text, and capability tokens are not printed or saved. The helper temporarily uses the clipboard under the same rules described above. Do not run this alongside another focus/clipboard test or copy new content during the check.

Add `--external` to use a separate target process. Use `--editor textarea` for a standard text area, or `--scenario changed`, `--scenario noop`, and `--scenario secure` for selection-change refusal, an already-matching draft with no paste, and password-field refusal. Output contains only fixed outcomes, booleans and event counts. These checks cover Electron editors, not all native controls, keyboard layouts, or signed application permission states.

Use `--editor rich-contenteditable --scenario empty` to exercise the empty-paragraph repair; add `--external` with `--scenario empty-multiline` to check cross-process multiline insertion. `empty-changed` refuses replacement of the captured empty child; `empty-ambiguous` refuses an unchanged adjusted expected value; `empty-blocked` verifies that blocked paste stays uncertain. `literal-newline` checks preservation of real LF text in textarea and rich contenteditable targets. `multiline` verifies textarea insertion, but deliberately expects uncertainty when a rich editor's AX projection omits a blank paragraph. The fixture never treats key dispatch alone as success.

## Opt-in Dock visibility check

```sh
env -u ELECTRON_RUN_AS_NODE corepack yarn workspace @cafecode/desktop exec electron scripts/smoke-dictation-dock.mjs --run-native-test
```

This Mac-only check opens isolated synthetic windows and verifies that the Dock icon and main window stay visible through repeated panel creation, recording HUD, review, hide and closure cycles. It uses a temporary profile and does not start Cafe, a provider or microphone, access the clipboard, or open your documents. Run it separately from other native focus tests. Add `--legacy` only to reproduce the old process-wide Dock-hiding behavior in this disposable fixture. The check verifies Dock state, not visual placement in every fullscreen/Spaces configuration.
