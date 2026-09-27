// Copyright (c) Cafe Code contributors. All rights reserved.
//
// This helper is intentionally narrower than a general-purpose accessibility or
// keyboard automation service. It is a single-client, one-shot insertion gate:
// capture the exact focused text element before Cafe shows its review panel,
// then replace its selected text only if the same app/window/element/selection
// and complete text value can still be verified. Native controls receive one
// AX text write. Following the user's explicit guarded-paste approval, web
// editors receive one process-targeted Command-V with a privately preserved
// clipboard. There is no arbitrary key/clipboard API, and no target text or
// proposed insertion is printed or persisted.

import AppKit
import ApplicationServices
import CryptoKit
import Darwin
import Foundation
import Security

private let maximumRequestBytes = 512 * 1024
private let maximumInsertionUTF8Bytes = 256 * 1024
private let maximumTargetUTF16Units = 1024 * 1024
private let attributeTimeoutSeconds: Float = 1.0
// Finish natively before the desktop client's six-second transport deadline.
// Each AX message also consumes this shared budget: ten individually bounded
// messages must not turn into a ten-second operation against an unresponsive app.
private let operationTimeoutSeconds: TimeInterval = 5.0
private let focusTimeoutSeconds: TimeInterval = 1.5
private let verificationTimeoutSeconds: TimeInterval = 1.0
private let focusPollSeconds: TimeInterval = 0.025
private let maximumClipboardItems = 16
private let maximumClipboardRepresentations = 64
private let maximumClipboardBytes = 8 * 1024 * 1024
// Apple's kVK_ANSI_V hardware key. This fixed Command-V sequence is the only
// keyboard operation authorized here; other keyboard layouts need their own
// native qualification and must not become renderer-selected key mappings.
private let pasteVirtualKey: CGKeyCode = 9
private let clipboardOwnershipType = NSPasteboard.PasteboardType(
  "com.cafecode.dictation.temporary-clipboard")
private let clipboardTransientType = NSPasteboard.PasteboardType("org.nspasteboard.TransientType")
private let clipboardConcealedType = NSPasteboard.PasteboardType("org.nspasteboard.ConcealedType")
private let systemElement = AXUIElementCreateSystemWide()
private let parentProcessID = getppid()
private var operationDeadline: TimeInterval?
private var processingRequest = false

private func monotonicTime() -> TimeInterval {
  ProcessInfo.processInfo.systemUptime
}

private func prepareMessage(_ element: AXUIElement) -> Bool {
  let remaining = (operationDeadline ?? (monotonicTime() + operationTimeoutSeconds))
    - monotonicTime()
  guard remaining > 0 else { return false }
  // Apple's AXUIElement.h explicitly makes timeouts instance-local, even for
  // equal AX references. Set one for every message, including freshly returned
  // focused elements, instead of relying on the capture's old reference.
  return AXUIElementSetMessagingTimeout(element, min(attributeTimeoutSeconds, Float(remaining)))
    == .success
}

private func serviceApplicationEvents(until deadline: TimeInterval) {
  let remaining = min(focusPollSeconds, deadline - monotonicTime())
  guard remaining > 0 else { return }
  // NSRunningApplication's changing properties are updated only when the main
  // run loop runs in a common mode. Sleeping here freezes activation/exit state.
  // Live AX focus remains the authority; this also lets AppKit finish handoff.
  RunLoop.current.run(until: Date().addingTimeInterval(remaining))
}

private enum InsertionMethod: String {
  case accessibility
  case paste
}

private struct CapturedTarget {
  let token: String
  let processID: pid_t
  let runningApplication: NSRunningApplication
  let application: AXUIElement
  let window: AXUIElement
  let element: AXUIElement
  let insertionMethod: InsertionMethod
  // Chromium exposes an empty rich paragraph's filler BR as one LF in AXValue.
  // Retain its exact empty container, not a renderer-chosen normalization rule.
  let emptyWebParagraph: AXUIElement?
  let selectedRange: CFRange
  // Keep only cryptographic commitments to the source field's text. The full
  // text is needed briefly to validate a write, but not while the user reviews
  // a dictation draft in Cafe's panel.
  let selectedTextDigest: SHA256.Digest
  let completeTextDigest: SHA256.Digest
}

private var capturedTarget: CapturedTarget?

// A fixed response vocabulary ensures AX provider errors cannot leak names,
// paths, field contents, or other private application metadata to the renderer.
private enum Failure: String {
  case invalidRequest = "invalid_request"
  case accessibilityPermission = "accessibility_permission_required"
  case clipboardUnavailable = "clipboard_unavailable"
  case targetUnavailable = "target_unavailable"
  case targetUnsupported = "target_unsupported"
  case targetChanged = "target_changed"
  case invalidToken = "invalid_token"
  case insertionUncertain = "insertion_uncertain"
}

private func copyAttribute(_ element: AXUIElement, _ attribute: String) -> CFTypeRef? {
  guard prepareMessage(element) else { return nil }
  var value: CFTypeRef?
  let result = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)
  return result == .success ? value : nil
}

private func copyElement(_ element: AXUIElement, _ attribute: String) -> AXUIElement? {
  guard let value = copyAttribute(element, attribute), CFGetTypeID(value) == AXUIElementGetTypeID()
  else { return nil }
  let result = value as! AXUIElement
  guard prepareMessage(result) else { return nil }
  return result
}

private func copyString(_ element: AXUIElement, _ attribute: String) -> String? {
  guard let value = copyAttribute(element, attribute), CFGetTypeID(value) == CFStringGetTypeID()
  else { return nil }
  return value as? String
}

private func copyRange(_ element: AXUIElement) -> CFRange? {
  guard let value = copyAttribute(element, kAXSelectedTextRangeAttribute),
    CFGetTypeID(value) == AXValueGetTypeID()
  else { return nil }
  let axValue = value as! AXValue
  guard AXValueGetType(axValue) == .cfRange else { return nil }
  var range = CFRange(location: 0, length: 0)
  guard AXValueGetValue(axValue, .cfRange, &range) else { return nil }
  return range
}

private func copyChildren(_ element: AXUIElement, maximum: Int) -> [AXUIElement]? {
  guard prepareMessage(element) else { return nil }
  var count: CFIndex = 0
  guard AXUIElementGetAttributeValueCount(element, kAXChildrenAttribute as CFString, &count)
    == .success, count >= 0, count <= maximum
  else { return nil }
  if count == 0 { return [] }
  guard prepareMessage(element) else { return nil }
  var result: CFArray?
  guard AXUIElementCopyAttributeValues(
    element, kAXChildrenAttribute as CFString, 0, count, &result
  ) == .success, let values = result as? [AnyObject], values.count == count else { return nil }
  var children: [AXUIElement] = []
  for value in values {
    guard CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
    let child = value as! AXUIElement
    guard prepareMessage(child) else { return nil }
    children.append(child)
  }
  return children
}

private func emptyWebParagraph(
  _ element: AXUIElement, window: AXUIElement, processID: pid_t,
  completeText: String, range: CFRange
) -> AXUIElement? {
  // This is deliberately not a trim or general rich-text projection. The
  // qualified Chromium empty <p><br></p> shape is one LF, a caret at zero, and
  // exactly one empty AXGroup with no exposed descendants. A literal textarea
  // newline, additional paragraphs, text, images, or opaque children cannot
  // enter this branch. Every reference remains in the captured PID/window.
  guard completeText.utf8.elementsEqual([0x0a]), range.location == 0, range.length == 0,
    copyString(element, kAXRoleAttribute) == (kAXTextAreaRole as String),
    let children = copyChildren(element, maximum: 1), children.count == 1
  else { return nil }
  let paragraph = children[0]
  guard elementProcessID(paragraph) == processID,
    copyString(paragraph, kAXRoleAttribute) == (kAXGroupRole as String),
    copyString(paragraph, kAXValueAttribute)?.isEmpty == true,
    let paragraphWindow = copyElement(paragraph, kAXWindowAttribute),
    sameElement(paragraphWindow, window),
    let parent = copyElement(paragraph, kAXParentAttribute), sameElement(parent, element),
    let descendants = copyChildren(paragraph, maximum: 0), descendants.isEmpty
  else { return nil }
  return paragraph
}

private func sameElement(_ left: AXUIElement, _ right: AXUIElement) -> Bool {
  // AXUIElement references represent remote UI objects, not a useful path or
  // label. CFEqual compares their accessibility identity without asking the
  // target app for user-visible content.
  CFEqual(left, right)
}

private func elementProcessID(_ element: AXUIElement) -> pid_t? {
  var pid: pid_t = 0
  guard AXUIElementGetPid(element, &pid) == .success, pid > 0 else { return nil }
  return pid
}

private func focusedApplication() -> (AXUIElement, pid_t)? {
  // NSWorkspace caches app state until its run loop receives notifications.
  // Query the system-wide AX object for security decisions about current focus.
  // Apple documents AXFocusedApplication as the app accepting keyboard input.
  guard let application = copyElement(systemElement, kAXFocusedApplicationAttribute),
    let pid = elementProcessID(application)
  else { return nil }
  return (application, pid)
}

private func hasCapturedFocus(_ target: CapturedTarget) -> Bool {
  guard let (application, pid) = focusedApplication(), pid == target.processID,
    sameElement(application, target.application),
    let window = copyElement(application, kAXFocusedWindowAttribute),
    let element = copyElement(application, kAXFocusedUIElementAttribute),
    elementProcessID(window) == target.processID,
    elementProcessID(element) == target.processID,
    sameElement(window, target.window),
    sameElement(element, target.element)
  else { return false }
  return true
}

private func mayRestoreFocus(_ target: CapturedTarget) -> Bool {
  guard getppid() == parentProcessID, let (_, pid) = focusedApplication() else { return false }
  return pid == parentProcessID || pid == target.processID
}

private func isEligibleTextElement(_ element: AXUIElement) -> Bool {
  guard let role = copyString(element, kAXRoleAttribute),
    role == (kAXTextFieldRole as String) || role == (kAXTextAreaRole as String)
  else { return false }

  // Password fields commonly expose AXSecureTextField as a subrole; never
  // inject into one even if an app incorrectly marks its selected text writable.
  if copyString(element, kAXSubroleAttribute) == (kAXSecureTextFieldSubrole as String) {
    return false
  }
  guard let enabled = copyAttribute(element, kAXEnabledAttribute) as? Bool, enabled else {
    return false
  }
  var settable = DarwinBoolean(false)
  guard
    prepareMessage(element),
    AXUIElementIsAttributeSettable(element, kAXSelectedTextAttribute as CFString, &settable)
      == .success, settable.boolValue
  else { return false }
  return true
}

private func insertionMethod(_ element: AXUIElement, processID: pid_t) -> InsertionMethod? {
  // Chromium's AXSelectedText setter can acknowledge success without changing
  // a web editor: its web delegate does not implement kReplaceSelectedText.
  // Verified against Electron 42's Chromium 148 implementation:
  // https://github.com/chromium/chromium/blob/148.0.7778.271/ui/accessibility/platform/browser_accessibility.cc
  // AccessibilityPerformAction rejects that action while the inherited Cocoa
  // setter discards the rejection. A successful AX return is not a text ACK.
  // Decide the user-visible method at capture, before any write, rather than
  // attempting an AX write and then replaying an uncertain edit as a paste.
  // Walk only this exact process and stop at the captured window. An opaque or
  // cyclic ancestry is unsupported; it is never permission to guess a method.
  var cursor = element
  var visited: [AXUIElement] = []
  for _ in 0..<32 {
    guard elementProcessID(cursor) == processID,
      !visited.contains(where: { sameElement($0, cursor) }),
      let role = copyString(cursor, kAXRoleAttribute)
    else { return nil }
    visited.append(cursor)
    if role == "AXWebArea" { return .paste }
    if role == (kAXWindowRole as String) { return .accessibility }
    guard let parent = copyElement(cursor, kAXParentAttribute) else { return nil }
    cursor = parent
  }
  return nil
}

private func checkedTextState(_ element: AXUIElement) -> (String, String, CFRange)? {
  guard let completeText = copyString(element, kAXValueAttribute),
    let selectedText = copyString(element, kAXSelectedTextAttribute),
    let range = copyRange(element)
  else { return nil }

  let full = completeText as NSString
  guard full.length <= maximumTargetUTF16Units,
    range.location >= 0,
    range.length >= 0,
    range.location <= full.length,
    range.length <= full.length - range.location,
    full.substring(with: NSRange(location: range.location, length: range.length)).utf8
      .elementsEqual(selectedText.utf8)
  else { return nil }
  return (completeText, selectedText, range)
}

private func mintToken() -> String? {
  var bytes = [UInt8](repeating: 0, count: 32)
  let status = bytes.withUnsafeMutableBytes { buffer in
    SecRandomCopyBytes(kSecRandomDefault, buffer.count, buffer.baseAddress!)
  }
  guard status == errSecSuccess else {
    return nil
  }
  return bytes.map { String(format: "%02x", $0) }.joined()
}

private func digest(_ text: String) -> SHA256.Digest {
  SHA256.hash(data: Data(text.utf8))
}

private func unchangedTargetText(_ target: CapturedTarget) -> String? {
  guard elementProcessID(target.window) == target.processID,
    elementProcessID(target.element) == target.processID,
    let window = copyElement(target.element, kAXWindowAttribute),
    sameElement(window, target.window),
    isEligibleTextElement(target.element),
    let (text, selection, range) = checkedTextState(target.element),
    range.location == target.selectedRange.location,
    range.length == target.selectedRange.length,
    digest(selection) == target.selectedTextDigest,
    digest(text) == target.completeTextDigest
  else { return nil }
  if let capturedParagraph = target.emptyWebParagraph {
    guard let currentParagraph = emptyWebParagraph(
      target.element, window: target.window, processID: target.processID,
      completeText: text, range: range
    ), sameElement(capturedParagraph, currentParagraph) else { return nil }
  }
  return text
}

private func requestCapturedFocus(_ target: CapturedTarget, until deadline: TimeInterval) -> Bool {
  // Never discover or substitute a new editable element during restoration.
  // The retained window/field have already passed the commitment check; each
  // action is fenced by fresh live focus so a third app wins over our handoff.
  guard mayRestoreFocus(target), !target.runningApplication.isTerminated else { return false }
  if focusedApplication()?.1 != target.processID {
    guard target.runningApplication.activate() else { return false }
  }
  // Activation acknowledges a request, not completed focus. In particular,
  // Chromium can reject a field-focus action while its app is still inactive.
  // Wait for the app before issuing either saved-window or saved-field action.
  while focusedApplication()?.1 != target.processID {
    guard mayRestoreFocus(target), !target.runningApplication.isTerminated,
      monotonicTime() < deadline
    else { return false }
    serviceApplicationEvents(until: deadline)
  }
  guard mayRestoreFocus(target), monotonicTime() < deadline else { return false }
  if hasCapturedFocus(target) { return true }
  guard unchangedTargetText(target) != nil, mayRestoreFocus(target) else { return false }

  // Raising the original window matters when Cafe itself was the target: app
  // activation alone can leave Cafe's review panel as the focused window.
  guard prepareMessage(target.window),
    AXUIElementPerformAction(target.window, kAXRaiseAction as CFString) == .success,
    mayRestoreFocus(target),
    prepareMessage(target.element),
    AXUIElementSetAttributeValue(target.element, kAXFocusedAttribute as CFString, kCFBooleanTrue)
      == .success
  else { return false }
  return true
}

private struct ClipboardSnapshot {
  let changeCount: Int
  // These are newly allocated, fully materialized items, not proxies belonging
  // to the old pasteboard owner. NSPasteboardItem proxies become invalid as
  // soon as ownership changes, so retaining the original items is not a backup.
  let items: [NSPasteboardItem]
}

private func snapshotClipboard(_ pasteboard: NSPasteboard) -> ClipboardSnapshot? {
  let initialCount = pasteboard.changeCount
  let sourceItems: [NSPasteboardItem]
  if let items = pasteboard.pasteboardItems {
    sourceItems = items
  } else {
    // Normally an empty board returns [], but accept an absent item list only
    // when its declared type list is also empty and ownership stayed stable.
    // A nonempty board whose items cannot be read must never be discarded.
    guard pasteboard.types?.isEmpty != false, pasteboard.changeCount == initialCount else {
      return nil
    }
    sourceItems = []
  }
  guard sourceItems.count <= maximumClipboardItems else { return nil }
  var items: [NSPasteboardItem] = []
  var totalBytes = 0
  var totalRepresentations = 0
  for source in sourceItems {
    let types = source.types
    guard !types.isEmpty,
      types.count <= maximumClipboardRepresentations - totalRepresentations
    else { return nil }
    totalRepresentations += types.count
    let item = NSPasteboardItem()
    for type in types {
      // File promises and lazy writers cannot be reconstructed as an ordinary
      // clipboard item. Refuse them before changing anything. Other binary,
      // rich-text, image and custom representations are retained byte-for-byte.
      guard type.rawValue.utf8.count <= 256,
        !type.rawValue.lowercased().contains("promise"),
        (source as NSPasteboardWriting).writingOptions?(forType: type, pasteboard: pasteboard)
          .contains(.promised) != true,
        let bytes = source.data(forType: type),
        bytes.count <= maximumClipboardBytes - totalBytes,
        item.setData(bytes, forType: type),
        pasteboard.changeCount == initialCount,
        monotonicTime() + verificationTimeoutSeconds < (operationDeadline ?? 0)
      else { return nil }
      totalBytes += bytes.count
    }
    items.append(item)
  }
  guard pasteboard.changeCount == initialCount else { return nil }
  return ClipboardSnapshot(changeCount: initialCount, items: items)
}

private func ownsClipboard(_ pasteboard: NSPasteboard, count: Int, marker: String) -> Bool {
  // Recheck changeCount after reading the marker: fetching data is an external
  // operation and another app may have become the owner while it was pending.
  pasteboard.changeCount == count
    && pasteboard.string(forType: clipboardOwnershipType) == marker
    && pasteboard.changeCount == count
}

private func restoreClipboard(
  _ snapshot: ClipboardSnapshot, pasteboard: NSPasteboard, count: Int, marker: String
) {
  guard ownsClipboard(pasteboard, count: count, marker: marker) else { return }
  // Restoring local data must not initiate a new Universal Clipboard transfer
  // merely because Cafe briefly borrowed the board for this operation.
  let clearedCount = pasteboard.prepareForNewContents(with: .currentHostOnly)
  // AppKit has no atomic compare-and-swap operation for pasteboard contents.
  // Fence both sides of the clear/write boundary and never overwrite a newer
  // observed owner. All representations have already been materialized.
  guard pasteboard.changeCount == clearedCount else { return }
  if !snapshot.items.isEmpty { _ = pasteboard.writeObjects(snapshot.items) }
}

private func verifiedInsertion(_ target: CapturedTarget, expected: String) -> Bool {
  let deadline = min(
    monotonicTime() + verificationTimeoutSeconds,
    operationDeadline ?? monotonicTime()
  )
  repeat {
    if let actual = copyString(target.element, kAXValueAttribute),
      actual.utf8.elementsEqual(expected.utf8),
      // Placeholder replacement also requires the original focused field and a
      // collapsed, bounded caret. Chromium's AXSelectedTextRange uses text
      // positions without generated paragraph separators, while AXValue uses
      // GetValueForControl with paragraph breaks (browser_accessibility_cocoa.mm
      // and ax_computed_node_data.cc, 148.0.7778.271). Their offsets are not
      // interchangeable. The byte-exact changed WHOLE value is the write ACK;
      // neither caret position nor dispatched keys are sufficient evidence.
      target.emptyWebParagraph == nil || (
        copyRange(target.element).map {
          $0.location >= 0 && $0.location <= (expected as NSString).length && $0.length == 0
        } == true && hasCapturedFocus(target)
      )
    {
      return true
    }
    serviceApplicationEvents(until: deadline)
  } while monotonicTime() < deadline
  return false
}

private func paste(_ target: CapturedTarget, text: String, expected: String) -> [String: Any] {
  let pasteboard = NSPasteboard.general
  guard let marker = mintToken(), let snapshot = snapshotClipboard(pasteboard),
    let keyDown = CGEvent(keyboardEventSource: nil, virtualKey: pasteVirtualKey, keyDown: true),
    let keyUp = CGEvent(keyboardEventSource: nil, virtualKey: pasteVirtualKey, keyDown: false)
  else { return failure(.clipboardUnavailable) }

  let temporaryItem = NSPasteboardItem()
  guard temporaryItem.setString(text, forType: .string),
    temporaryItem.setString(marker, forType: clipboardOwnershipType),
    temporaryItem.setData(Data(), forType: clipboardTransientType),
    temporaryItem.setData(Data(), forType: clipboardConcealedType)
  else { return failure(.clipboardUnavailable) }
  keyDown.flags = .maskCommand
  keyUp.flags = .maskCommand

  // Snapshotting can invoke another app's clipboard provider. Revalidate every
  // original target commitment after it completes, before touching clipboard.
  guard unchangedTargetText(target) != nil, hasCapturedFocus(target) else {
    return failure(.targetChanged)
  }
  guard pasteboard.changeCount == snapshot.changeCount,
    monotonicTime() + verificationTimeoutSeconds < (operationDeadline ?? 0)
  else { return failure(.clipboardUnavailable) }
  let clearedCount = pasteboard.prepareForNewContents(with: .currentHostOnly)
  guard pasteboard.changeCount == clearedCount else { return failure(.clipboardUnavailable) }
  guard pasteboard.writeObjects([temporaryItem]) else {
    // No paste was dispatched. Restore only if the failed staging operation
    // left the exact empty state we cleared, or our complete ownership marker.
    // A third party's clipboard must win even when staging itself failed.
    if pasteboard.changeCount == clearedCount, pasteboard.types?.isEmpty != false {
      if !snapshot.items.isEmpty { _ = pasteboard.writeObjects(snapshot.items) }
    } else {
      restoreClipboard(snapshot, pasteboard: pasteboard, count: clearedCount, marker: marker)
    }
    return failure(.clipboardUnavailable)
  }
  // writeObjects fills the generation created by prepareForNewContents; it
  // does not mint another changeCount. Retain our returned generation rather
  // than accidentally adopting a clipboard owner that raced the write.
  let ownedCount = clearedCount
  var dispatched = false
  var verified = false
  defer {
    // Restoring after an uncertain dispatch is unsafe: a delayed target could
    // consume the old clipboard instead of the draft. In that case leave the
    // clipboard untouched and let the fixed UI explain that the draft may
    // remain there. There is never a second paste or a later background retry.
    if !dispatched || verified {
      restoreClipboard(snapshot, pasteboard: pasteboard, count: ownedCount, marker: marker)
    }
  }
  guard unchangedTargetText(target) != nil, hasCapturedFocus(target),
    monotonicTime() + verificationTimeoutSeconds < (operationDeadline ?? 0)
  else { return failure(.targetChanged) }
  guard ownsClipboard(pasteboard, count: ownedCount, marker: marker) else {
    return failure(.clipboardUnavailable)
  }
  // Reading the ownership marker crosses an external boundary. Check focus
  // again afterward, then make a final cheap generation/deadline check before
  // posting the fixed pair. There is no deferred activation or queued retry.
  guard hasCapturedFocus(target) else { return failure(.targetChanged) }
  guard pasteboard.changeCount == ownedCount,
    monotonicTime() + verificationTimeoutSeconds < (operationDeadline ?? 0)
  else { return failure(.clipboardUnavailable) }

  // This sole, fixed shortcut was explicitly approved for web-editor insertion.
  // Post directly to the captured PID (never the global event stream), with no
  // Return/Enter or arbitrary key/text event surface. CGEvent has no delivery
  // acknowledgement; once key-down is posted every failure is uncertain.
  dispatched = true
  keyDown.postToPid(target.processID)
  keyUp.postToPid(target.processID)
  verified = verifiedInsertion(target, expected: expected)
  return verified ? ["ok": true] : failure(.insertionUncertain, uncertain: true)
}

private func capture() -> [String: Any] {
  // Replacing a capture invalidates all earlier tokens. The helper never
  // retains multiple field handles, which keeps the privacy/lifetime boundary
  // obvious when a user invokes dictation again.
  capturedTarget = nil
  guard AXIsProcessTrusted() else { return failure(.accessibilityPermission) }
  guard let (application, pid) = focusedApplication(),
    let frontmost = NSRunningApplication(processIdentifier: pid),
    !frontmost.isTerminated
  else { return failure(.targetUnavailable) }

  guard let window = copyElement(application, kAXFocusedWindowAttribute),
    let element = copyElement(application, kAXFocusedUIElementAttribute)
  else { return failure(.targetUnavailable) }

  guard elementProcessID(window) == pid,
    elementProcessID(element) == pid,
    let elementWindow = copyElement(element, kAXWindowAttribute),
    sameElement(window, elementWindow),
    isEligibleTextElement(element),
    let method = insertionMethod(element, processID: pid),
    let (completeText, selectedText, range) = checkedTextState(element),
    let token = mintToken()
  else { return failure(.targetUnsupported) }

  let target = CapturedTarget(
    token: token,
    processID: pid,
    runningApplication: frontmost,
    application: application,
    window: window,
    element: element,
    insertionMethod: method,
    emptyWebParagraph: method == .paste
      ? emptyWebParagraph(
        element, window: window, processID: pid, completeText: completeText, range: range
      ) : nil,
    selectedRange: range,
    selectedTextDigest: digest(selectedText),
    completeTextDigest: digest(completeText)
  )
  // Attribute reads can take time. Do not bind a capture to a field which lost
  // focus while its value/selection were being checked.
  guard hasCapturedFocus(target) else { return failure(.targetChanged) }
  capturedTarget = target
  return ["ok": true, "token": token, "insertionMethod": method.rawValue]
}

private func failure(_ code: Failure, uncertain: Bool = false) -> [String: Any] {
  ["ok": false, "code": code.rawValue, "uncertain": uncertain]
}

private func insertion(_ token: String, _ text: String) -> [String: Any] {
  guard let target = capturedTarget, token == target.token else {
    return failure(.invalidToken)
  }
  // Consume before activation or the AX write. An AX timeout can be ambiguous:
  // neither this helper nor its caller may replay the same insertion.
  capturedTarget = nil

  // The user should still be in Cafe's review panel (our parent process), or
  // already back in the original app after the panel was hidden. If a third
  // app became frontmost, activating the old target would surprise the user.
  guard AXIsProcessTrusted() else { return failure(.accessibilityPermission) }
  guard mayRestoreFocus(target), unchangedTargetText(target) != nil else {
    return failure(.targetChanged)
  }
  guard !target.runningApplication.isTerminated else { return failure(.targetUnavailable) }
  let deadline = min(
    monotonicTime() + focusTimeoutSeconds,
    (operationDeadline ?? monotonicTime()) - verificationTimeoutSeconds
  )
  guard requestCapturedFocus(target, until: deadline) else { return failure(.targetChanged) }

  // Application activation, window activation, and Chromium's accessible
  // focused element can settle on different turns of the event loop. Wait for
  // the complete retained identity, never merely for an app's active flag.
  var currentText: String?
  repeat {
    guard mayRestoreFocus(target), !target.runningApplication.isTerminated,
      monotonicTime() < deadline
    else { return failure(.targetChanged) }
    if hasCapturedFocus(target) {
      guard let unchanged = unchangedTargetText(target), hasCapturedFocus(target),
        monotonicTime() < deadline
      else { return failure(.targetChanged) }
      currentText = unchanged
      break
    }
    serviceApplicationEvents(until: deadline)
  } while monotonicTime() < deadline
  guard let currentText, hasCapturedFocus(target), monotonicTime() < deadline,
    prepareMessage(target.element)
  else {
    return failure(.targetChanged)
  }

  let original = currentText as NSString
  let range = NSRange(location: target.selectedRange.location, length: target.selectedRange.length)
  let ordinaryExpected = original.replacingCharacters(in: range, with: text)
  // A no-op replacement already has the expected field value. Dispatching a
  // paste here would falsely "verify" before the app consumed the clipboard,
  // then restore the old clipboard underneath a delayed Command-V. Complete
  // without any write instead. Use exact UTF-8 equality, not Swift String's
  // canonical-equivalence comparison, both here and when acknowledging a write.
  if currentText.utf8.elementsEqual(ordinaryExpected.utf8) { return ["ok": true] }
  // Blink removes the sole empty rich paragraph's placeholder BR when it
  // inserts real content. Treating its AX LF as user text wrongly demanded a
  // trailing newline after an otherwise exact successful paste. This narrow
  // shape was bound at capture and revalidated above and again in paste().
  // Source: Chromium 148 ReplaceSelectionCommand::ShouldRemoveEndBR and
  // RemovePlaceholderAt in third_party/blink/renderer/core/editing/commands/
  // replace_selection_command.cc (tag 148.0.7778.271). No other newline or
  // Unicode normalization is permitted. If the adjusted expected value already
  // existed, it could not prove clipboard consumption: refuse before dispatch.
  let expected = target.emptyWebParagraph == nil ? ordinaryExpected : text
  guard !currentText.utf8.elementsEqual(expected.utf8) else {
    return failure(.targetUnsupported)
  }
  if target.insertionMethod == .paste {
    return paste(target, text: text, expected: expected)
  }
  let writeResult = AXUIElementSetAttributeValue(
    target.element,
    kAXSelectedTextAttribute as CFString,
    text as CFString
  )
  if writeResult != .success {
    // A transport failure after dispatch cannot prove that the target did not
    // apply the write. Report uncertainty and leave the draft with the caller.
    return failure(.insertionUncertain, uncertain: true)
  }

  // A successful AX call is not proof that an editor actually inserted text.
  // Verify the whole field value, allowing a brief async accessibility update.
  return verifiedInsertion(target, expected: expected)
    ? ["ok": true] : failure(.insertionUncertain, uncertain: true)
}

private func processRequest(_ line: Data) -> [String: Any] {
  // Focus polling services AppKit events. If an input source is ever delivered
  // reentrantly, terminate the private channel instead of allowing a nested
  // capture/discard/insert to revive or replace authority in the outer request.
  guard !processingRequest else { Darwin.exit(1) }
  processingRequest = true
  operationDeadline = monotonicTime() + operationTimeoutSeconds
  defer {
    operationDeadline = nil
    processingRequest = false
  }
  guard let json = try? JSONSerialization.jsonObject(with: line) as? [String: Any],
    let id = json["id"] as? Int, id >= 0,
    let command = json["command"] as? String
  else { return ["id": 0].merging(failure(.invalidRequest)) { _, new in new } }

  let result: [String: Any]
  switch command {
  case "capture":
    result = capture()
  case "insert":
    guard let token = json["token"] as? String,
      token.utf8.count == 64,
      let text = json["text"] as? String,
      !text.utf8.contains(0),
      text.utf8.count <= maximumInsertionUTF8Bytes
    else {
      result = failure(.invalidRequest)
      break
    }
    result = insertion(token, text)
  case "discard":
    capturedTarget = nil
    result = ["ok": true]
  default:
    result = failure(.invalidRequest)
  }
  return ["id": id].merging(result) { _, new in new }
}

private func writeResponse(_ response: [String: Any]) {
  guard let data = try? JSONSerialization.data(withJSONObject: response) else { Darwin.exit(1) }
  var line = data
  line.append(0x0a)
  FileHandle.standardOutput.write(line)
}

// No command-line payloads or environment-based instructions are supported.
// The private stream protocol has one bounded JSON request per line and fixed,
// content-free responses. Closing stdin drops the retained AX target and exits.
// Read from a nonblocking main-queue source so the main run loop remains live
// throughout review. A blocking read on this thread freezes AppKit's workspace
// notifications, even when the desktop itself continues running normally.
var pending = Data()
let inputFlags = fcntl(STDIN_FILENO, F_GETFL)
guard inputFlags >= 0, fcntl(STDIN_FILENO, F_SETFL, inputFlags | O_NONBLOCK) == 0 else {
  Darwin.exit(1)
}
let inputSource = DispatchSource.makeReadSource(fileDescriptor: STDIN_FILENO, queue: .main)
inputSource.setEventHandler {
  guard !processingRequest else { Darwin.exit(1) }
  var chunk = [UInt8](repeating: 0, count: 4096)
  while true {
    let readCount = Darwin.read(STDIN_FILENO, &chunk, chunk.count)
    if readCount == 0 { Darwin.exit(0) }
    if readCount < 0 {
      if errno == EINTR { continue }
      if errno == EAGAIN || errno == EWOULDBLOCK { return }
      Darwin.exit(1)
    }
    for byte in chunk[0..<readCount] {
      if byte == 0x0a {
        let request = pending
        pending.removeAll(keepingCapacity: true)
        writeResponse(processRequest(request))
      } else {
        pending.append(byte)
        if pending.count > maximumRequestBytes {
          writeResponse(["id": 0].merging(failure(.invalidRequest)) { _, new in new })
          Darwin.exit(1)
        }
      }
    }
  }
}
// A command-line Foundation run loop alone does not initialize AppKit's native
// accessibility connection. Without NSApplication initialization, real AX
// requests can immediately return cannotComplete even when trust is granted.
// Remain prohibited from activation: this helper must never become a third
// application in the focus handoff or create any user-visible window.
let helperApplication = NSApplication.shared
helperApplication.setActivationPolicy(.prohibited)
inputSource.resume()
// Keep an input source in the default/common run-loop mode even before the
// first NSRunningApplication is constructed; RunLoop.run must not return just
// because stdin has not received its first request yet.
let keepAlivePort = Port()
RunLoop.main.add(keepAlivePort, forMode: .default)
RunLoop.main.run()
