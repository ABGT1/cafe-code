/**
 * Opt-in macOS native insertion smoke. Build the native helper first, then:
 *
 * corepack yarn workspace @cafecode/desktop exec electron scripts/smoke-dictation-insert.mjs --run-native-test --editor contenteditable
 * Add --external for a second isolated Electron target process, or choose
 * --editor textarea|rich-contenteditable. Rich-editor scenarios include empty,
 * empty-multiline, empty-changed, empty-blocked and empty-ambiguous. The
 * literal-newline scenario proves real LF data is retained. Multiline with
 * blank paragraphs deliberately expects uncertainty on a normal rich editor
 * whose AX value collapses those paragraphs; it must never be normalized.
 *
 * This takes focus only for synthetic windows. It never starts Cafe, a provider,
 * a microphone, or a network session, and never opens a user document. The real
 * clipboard is read only for an in-memory digest of all Electron-exposed formats;
 * only the native helper may temporarily modify it. Neither digest, clipboard
 * data, target text, helper token, nor raw errors are printed or persisted.
 * Do not run concurrently with another native focus/clipboard test.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const scriptPath = fileURLToPath(import.meta.url);
const originalText = "Synthetic original";
const replacementText = "replacement 🧪 café e\u0301";
const multilineReplacementText = `${replacementText}\nSecond line\n\nFourth line`;
const emptyScenarios = new Set([
  "empty",
  "empty-blocked",
  "empty-multiline",
  "empty-ambiguous",
  "empty-changed",
]);

/** Fixed synthetic data only; callers cannot supply text, HTML, or a target. */
export function syntheticFixture(options) {
  const empty = emptyScenarios.has(options.scenario);
  const literalNewline = options.scenario === "literal-newline";
  const initialText = empty ? "" : literalNewline ? "\n" : originalText;
  const text =
    options.scenario === "noop"
      ? "original"
      : options.scenario === "empty-ambiguous"
        ? "\n"
        : options.scenario === "multiline"
          ? multilineReplacementText
          : options.scenario === "empty-multiline"
            ? `${replacementText}\nSecond line`
            : replacementText;
  const selection = empty || literalNewline ? [0, 0] : [10, 18];
  const expected = initialText.slice(0, selection[0]) + text + initialText.slice(selection[1]);
  const expectedOutcome = ["changed", "empty-changed"].includes(options.scenario)
    ? "target_changed"
    : options.scenario === "empty-ambiguous"
      ? "target_unsupported"
      : options.scenario === "empty-blocked" ||
          (options.scenario === "multiline" && options.editor !== "textarea")
        ? "insertion_uncertain"
        : "succeeded";
  const expectedPasteEvents = ["changed", "empty-changed", "noop", "empty-ambiguous"].includes(
    options.scenario,
  )
    ? 0
    : 1;
  return {
    empty,
    initialText,
    text,
    selection,
    expected,
    expectedOutcome,
    expectedPasteEvents,
    expectedInputEvents: options.scenario === "empty-blocked" ? 0 : expectedPasteEvents,
  };
}
const nativeCodes = new Set([
  "invalid_request",
  "accessibility_permission_required",
  "target_unavailable",
  "target_unsupported",
  "target_changed",
  "invalid_token",
  "insertion_uncertain",
  "clipboard_unavailable",
]);
const delay = (milliseconds) => new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));

export function parseSmokeArguments(args, hasParentChannel = false) {
  const { values } = parseArgs({
    args,
    options: {
      "run-native-test": { type: "boolean" },
      editor: { type: "string", default: "contenteditable" },
      scenario: { type: "string", default: "success" },
      external: { type: "boolean", default: false },
      "synthetic-child": { type: "boolean", default: false },
      "fixture-user-data": { type: "string" },
    },
  });
  if (values["run-native-test"] !== true) throw new Error("explicit_opt_in_required");
  if (!["contenteditable", "rich-contenteditable", "textarea"].includes(values.editor))
    throw new Error("invalid_editor");
  if (
    ![
      "success",
      "multiline",
      "changed",
      "secure",
      "noop",
      "empty",
      "empty-blocked",
      "empty-multiline",
      "empty-ambiguous",
      "empty-changed",
      "literal-newline",
    ].includes(values.scenario)
  )
    throw new Error("invalid_scenario");
  if (
    (emptyScenarios.has(values.scenario) && values.editor !== "rich-contenteditable") ||
    (values.scenario === "literal-newline" &&
      !["textarea", "rich-contenteditable"].includes(values.editor))
  )
    throw new Error("invalid_fixture_pair");
  if (values["synthetic-child"] && (!hasParentChannel || !values["fixture-user-data"])) {
    throw new Error("private_parent_channel_required");
  }
  if (!values["synthetic-child"] && values["fixture-user-data"] !== undefined) {
    throw new Error("private_child_option");
  }
  return {
    editor: values.editor,
    scenario: values.scenario,
    external: values.external,
    child: values["synthetic-child"],
    userData: values["fixture-user-data"],
  };
}

function timed(promise, milliseconds, stage) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(stage)), milliseconds);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function waitFor(predicate, milliseconds, stage) {
  const deadline = performance.now() + milliseconds;
  while (!predicate()) {
    if (performance.now() >= deadline) throw new Error(stage);
    await delay(25);
  }
}

/** Length framing makes format/data boundaries unambiguous; nothing leaves memory. */
function clipboardDigest(clipboard) {
  const digest = createHash("sha256");
  for (const format of clipboard.availableFormats().toSorted()) {
    const name = Buffer.from(format, "utf8");
    const data = clipboard.readBuffer(format);
    for (const bytes of [name, data]) {
      const length = Buffer.alloc(8);
      length.writeBigUInt64BE(BigInt(bytes.length));
      digest.update(length).update(bytes);
    }
  }
  return digest.digest("hex");
}

function sanitizedReply(reply) {
  return {
    ok: reply?.ok === true,
    ...(nativeCodes.has(reply?.code) ? { code: reply.code } : {}),
    ...(reply?.uncertain === true ? { uncertain: true } : {}),
  };
}

function createHelper() {
  const helperPath = join(
    dirname(scriptPath),
    "..",
    "native",
    "build",
    process.arch,
    "mac-dictation-target",
  );
  const stat = lstatSync(helperPath);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o111) === 0)
    throw new Error("helper_unavailable");
  const child = spawn(helperPath, [], {
    cwd: "/",
    env: {},
    stdio: ["pipe", "pipe", "ignore"],
    shell: false,
  });
  let pending = null;
  let buffered = "";
  let nextId = 0;
  const exited = new Promise((resolveExit) => child.once("exit", resolveExit));
  const fail = () => {
    pending?.reject(new Error("helper_transport_failed"));
    pending = null;
  };
  child.on("error", fail);
  child.on("exit", fail);
  child.stdin.on("error", fail);
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffered += chunk;
    if (buffered.length > 16_384) {
      fail();
      return;
    }
    let newline;
    while ((newline = buffered.indexOf("\n")) >= 0) {
      const line = buffered.slice(0, newline);
      buffered = buffered.slice(newline + 1);
      try {
        const reply = JSON.parse(line);
        if (!pending || reply?.id !== pending.id || typeof reply.ok !== "boolean") {
          fail();
          return;
        }
        const current = pending;
        pending = null;
        current.resolve(reply);
      } catch {
        fail();
      }
    }
  });
  return {
    async request(command) {
      if (pending) throw new Error("overlapping_helper_request");
      const id = ++nextId;
      // The native operation has its own five-second budget. Leave time for
      // native clipboard cleanup; a transport timeout is never a retry signal.
      return await timed(
        new Promise((resolveReply, reject) => {
          pending = { id, resolve: resolveReply, reject };
          child.stdin.write(`${JSON.stringify({ id, ...command })}\n`);
        }),
        8_000,
        "helper_timeout_uncertain",
      );
    },
    async close() {
      child.stdin.end();
      if (child.exitCode !== null || child.signalCode !== null) return;
      try {
        await timed(exited, 2_000, "helper_close_timeout");
      } catch {
        child.kill("SIGTERM");
        try {
          await timed(exited, 1_000, "helper_close_timeout");
        } catch {
          child.kill("SIGKILL");
          await exited;
        }
      }
    },
  };
}

async function createTarget(electron, options) {
  const { BrowserWindow, app } = electron;
  const fixture = syntheticFixture(options);
  const window = new BrowserWindow({
    width: 600,
    height: 280,
    title: "Synthetic dictation target — no user document",
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  const editor =
    options.scenario === "secure"
      ? `<input id="editor" type="password" value="${originalText}">`
      : options.editor === "textarea"
        ? `<textarea id="editor">${fixture.initialText}</textarea>`
        : `<div id="editor" contenteditable="true" role="textbox" aria-multiline="true">${options.editor === "rich-contenteditable" ? `<p${options.scenario === "literal-newline" ? ' style="white-space:pre-wrap"' : ""}>${fixture.empty ? "<br>" : fixture.initialText}</p>` : fixture.initialText}</div>`;
  await window.loadURL(
    `data:text/html,${encodeURIComponent(`<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; form-action 'none'"><body style="font:18px sans-serif;padding:20px"><p>Synthetic dictation smoke — no user document</p><form>${editor}<button type="submit">Synthetic submit</button></form><script>
    window.fixtureCounts = { input: 0, paste: 0, submit: 0 };
    if (document.querySelector('#editor').tagName === 'TEXTAREA') document.querySelector('#editor').value = ${JSON.stringify(fixture.initialText)};
    document.querySelector('#editor').addEventListener('input', () => fixtureCounts.input++);
    document.querySelector('#editor').addEventListener('paste', event => { fixtureCounts.paste++; ${options.scenario === "empty-blocked" ? "event.preventDefault();" : ""} });
    document.querySelector('form').addEventListener('submit', event => { event.preventDefault(); fixtureCounts.submit++; });
  </script></body>`)}`,
  );
  return {
    async focus() {
      window.show();
      app.focus({ steal: true });
      window.focus();
      await window.webContents.executeJavaScript(`{
        const editor = document.querySelector('#editor'); editor.focus();
        if (editor.setSelectionRange) editor.setSelectionRange(${fixture.selection[0]}, ${fixture.selection[1]});
        else { const node = ${fixture.empty ? "editor.firstChild" : "editor.firstChild.nodeType === Node.TEXT_NODE ? editor.firstChild : editor.firstChild.firstChild"}; const range = document.createRange(); range.setStart(node, ${fixture.selection[0]}); range.setEnd(node, ${fixture.selection[1]}); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); }
      }`);
      await waitFor(() => window.isFocused(), 2_000, "synthetic_target_not_focused");
      // Let Chromium publish the focused editable's AX snapshot before capture.
      await delay(350);
      return { focused: window.isFocused() };
    },
    async changeSelection() {
      await window.webContents.executeJavaScript(`{
        const editor = document.querySelector('#editor');
        ${options.scenario === "empty-changed" ? "editor.replaceChildren(Object.assign(document.createElement('p'), { innerHTML: '<br>' }));" : ""}
        if (editor.setSelectionRange) editor.setSelectionRange(0, 0);
        else { const node = ${fixture.empty ? "editor.firstChild" : "editor.firstChild.nodeType === Node.TEXT_NODE ? editor.firstChild : editor.firstChild.firstChild"}; const range = document.createRange(); range.setStart(node, 0); range.collapse(true); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); }
      }`);
      await delay(200);
      return { changed: true };
    },
    async inspect() {
      // Only booleans/counters cross the renderer/process boundary. Expected
      // text is synthetic and equality intentionally checks Unicode code units.
      return await window.webContents.executeJavaScript(`(() => {
        const editor = document.querySelector('#editor');
        // This fixture's rich editor model is one paragraph per logical line.
        // innerText adds CSS paragraph spacing and is not the model's plain
        // text. Never use this fixture-only DOM projection in native code.
        const text = editor.value ?? (${options.editor === "rich-contenteditable"} ? [...editor.children].map(paragraph => paragraph.textContent).join('\\n') : editor.innerText);
        return { original: text === ${JSON.stringify(fixture.initialText)}, replaced: text === ${JSON.stringify(fixture.expected)}, ...window.fixtureCounts };
      })()`);
    },
    async close() {
      if (!window.isDestroyed()) window.destroy();
    },
  };
}

async function createExternalTarget(options, directory) {
  mkdirSync(directory, { mode: 0o700 });
  const child = spawn(
    process.execPath,
    [
      scriptPath,
      "--run-native-test",
      "--synthetic-child",
      "--fixture-user-data",
      directory,
      "--editor",
      options.editor,
      "--scenario",
      options.scenario,
    ],
    { cwd: "/", env: {}, stdio: ["ignore", "ignore", "ignore", "ipc"], shell: false },
  );
  let pending = null;
  let id = 0;
  const exited = new Promise((resolveExit) => child.once("exit", resolveExit));
  const ready = new Promise((resolveReady, reject) => {
    child.once("error", () => reject(new Error("external_start_failed")));
    child.on("message", (message) => {
      if (message?.type === "ready") resolveReady();
      else if (pending && message?.id === pending.id) {
        const current = pending;
        pending = null;
        if (message.ok === true) current.resolve(message.result);
        else current.reject(new Error("external_fixture_failed"));
      }
    });
  });
  const call = (action) =>
    timed(
      new Promise((resolveReply, reject) => {
        const next = ++id;
        pending = { id: next, resolve: resolveReply, reject };
        child.send({ id: next, action }, (error) => {
          if (error) {
            pending = null;
            reject(new Error("external_channel_failed"));
          }
        });
      }),
      5_000,
      "external_timeout",
    );
  const close = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    if (child.connected) child.disconnect();
    try {
      await timed(exited, 2_000, "external_close_timeout");
    } catch {
      child.kill("SIGKILL");
      await exited;
    }
  };
  try {
    await timed(ready, 8_000, "external_start_timeout");
  } catch (error) {
    await close();
    throw error;
  }
  return {
    focus: () => call("focus"),
    changeSelection: () => call("change"),
    inspect: () => call("inspect"),
    close,
  };
}

async function runChild(electron, options) {
  const target = await createTarget(electron, options);
  process.on("disconnect", () => electron.app.exit(0));
  process.on("message", async (message) => {
    if (!Number.isSafeInteger(message?.id)) return;
    try {
      const action = {
        focus: target.focus,
        change: target.changeSelection,
        inspect: target.inspect,
      }[message.action];
      if (!action) throw new Error("invalid_fixture_action");
      process.send?.({ id: message.id, ok: true, result: await action() });
    } catch {
      process.send?.({ id: message.id, ok: false });
    }
  });
  process.send?.({ type: "ready" });
}

async function runSmoke(electron, options, directory) {
  const fixture = syntheticFixture(options);
  const result = {
    editor: options.editor,
    scenario: options.scenario,
    external: options.external,
    passed: false,
  };
  let target;
  let helper;
  let review;
  let ownerWindow;
  let stage = "setup";
  const beforeClipboard = clipboardDigest(electron.clipboard);
  try {
    if (options.external) {
      // Cafe normally retains its main window behind the review. Keep the same
      // ownership condition here: hiding the owner's last/only window could
      // otherwise activate an unrelated user app, which must correctly cause
      // the helper's guarded focus handoff to fail closed.
      ownerWindow = new electron.BrowserWindow({
        width: 400,
        height: 180,
        title: "Synthetic Cafe owner — no user data",
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
      });
      await ownerWindow.loadURL("data:text/html,Synthetic%20Cafe%20owner");
    }
    target = options.external
      ? await createExternalTarget(options, join(directory, "target"))
      : await createTarget(electron, options);
    stage = "focus";
    if (!(await target.focus()).focused) throw new Error("synthetic_target_not_focused");
    helper = createHelper();
    stage = "capture";
    const captured = await helper.request({ command: "capture" });
    result.capture = sanitizedReply(captured);
    if (options.scenario === "secure") {
      if (captured.ok || captured.code !== "target_unsupported")
        throw new Error("secure_field_not_denied");
      result.passed = true;
    } else {
      if (
        !captured.ok ||
        !/^[a-f0-9]{64}$/u.test(captured.token ?? "") ||
        captured.insertionMethod !== "paste"
      ) {
        throw new Error("capture_did_not_bind_paste");
      }
      result.method = "paste";
      if (["changed", "empty-changed"].includes(options.scenario)) await target.changeSelection();
      stage = "review_handoff";
      review = new electron.BrowserWindow({
        width: 490,
        height: 510,
        title: "Synthetic dictation review",
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
      });
      await review.loadURL(
        "data:text/html,Synthetic%20dictation%20review%20%E2%80%94%20no%20user%20data",
      );
      review.show();
      electron.app.focus({ steal: true });
      review.focus();
      await waitFor(() => review.isFocused(), 2_000, "synthetic_review_not_focused");
      review.hide();
      await waitFor(() => !review.isFocused(), 1_000, "synthetic_review_not_hidden");
      stage = "insert";
      const text = fixture.text;
      result.expectedOutcome = fixture.expectedOutcome;
      result.primaryInsertAttempts = 1;
      const inserted = await helper.request({ command: "insert", token: captured.token, text });
      result.insert = sanitizedReply(inserted);
      stage = "verify";
      const expectedEvents = fixture.expectedPasteEvents;
      let inspected = await target.inspect();
      for (let attempt = 0; attempt < 20 && inspected.paste < expectedEvents; attempt++) {
        await delay(50);
        inspected = await target.inspect();
      }
      result.correctText =
        fixture.expectedInputEvents === 1 ? inspected.replaced : inspected.original;
      result.inputEvents = inspected.input;
      result.pasteEvents = inspected.paste;
      result.submitEvents = inspected.submit;
      if (
        (fixture.expectedOutcome === "succeeded"
          ? !inserted.ok
          : inserted.ok ||
            inserted.code !== fixture.expectedOutcome ||
            (inserted.uncertain === true) !==
              (fixture.expectedOutcome === "insertion_uncertain")) ||
        !result.correctText ||
        inspected.input !== fixture.expectedInputEvents ||
        inspected.paste !== expectedEvents ||
        inspected.submit !== 0
      )
        throw new Error("fixture_postcondition_failed");
      stage = "token_reuse";
      const replay = await helper.request({ command: "insert", token: captured.token, text });
      result.repeatRefused = replay.ok === false && replay.code === "invalid_token";
      inspected = await target.inspect();
      if (
        !result.repeatRefused ||
        inspected.input !== fixture.expectedInputEvents ||
        inspected.paste !== expectedEvents ||
        inspected.submit !== 0
      )
        throw new Error("token_reuse_not_denied");
      result.passed = true;
    }
    stage = "complete";
  } catch (error) {
    result.passed = false;
    // Fixed error classifications only: never print a native/renderer message.
    if (error instanceof Error && error.message === "helper_timeout_uncertain")
      result.uncertain = true;
  } finally {
    // Never restore the clipboard here, including after a timeout. Only the
    // native owner knows whether an asynchronously dispatched paste consumed it.
    await helper?.close();
    await target?.close();
    if (review && !review.isDestroyed()) review.destroy();
    if (ownerWindow && !ownerWindow.isDestroyed()) ownerWindow.destroy();
    result.clipboardPreserved = clipboardDigest(electron.clipboard) === beforeClipboard;
    // An uncertain dispatched paste intentionally keeps the draft clipboard:
    // restoring unrelated old data before delayed consumption would be unsafe.
    // Report only exact equality to our fixed synthetic draft, never its data.
    if (result.insert?.uncertain === true && fixture.expectedOutcome === "insertion_uncertain") {
      result.draftClipboardRetained = electron.clipboard.readText() === fixture.text;
      if (!result.draftClipboardRetained) result.passed = false;
    } else if (!result.clipboardPreserved) result.passed = false;
    result.stage = stage;
  }
  console.log(JSON.stringify(result));
  return result.passed ? 0 : 1;
}

async function main() {
  const options = parseSmokeArguments(process.argv.slice(2), typeof process.send === "function");
  if (process.platform !== "darwin" || !process.versions.electron)
    throw new Error("macos_electron_required");
  const electron = await import("electron");
  const directory = options.child ? null : mkdtempSync(join(tmpdir(), "cafecode-dictation-smoke-"));
  const userData = options.child ? options.userData : join(directory, "review");
  if (!options.child) mkdirSync(userData, { mode: 0o700 });
  electron.app.setPath("userData", userData);
  electron.app.commandLine.appendSwitch("disable-background-networking");
  electron.app.on("window-all-closed", () => {});
  await electron.app.whenReady();
  electron.app.setAccessibilitySupportEnabled(true);
  electron.session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  );
  electron.session.defaultSession.webRequest.onBeforeRequest(
    { urls: ["*://*/*"] },
    (_details, callback) => callback({ cancel: true }),
  );
  if (options.child) {
    await runChild(electron, options);
    return;
  }
  let code = 1;
  try {
    code = await runSmoke(electron, options, directory);
  } finally {
    // The mkdtemp root contains only this run's isolated browser profiles, and
    // all synthetic children have been stopped before these files are removed.
    rmSync(directory, { recursive: true, force: true });
    electron.app.exit(code);
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === scriptPath) {
  void main().catch(() => {
    console.error(
      "Native dictation smoke could not start. Use macOS Electron with --run-native-test and a built helper; Accessibility permission is required.",
    );
    process.exitCode = 1;
    // Electron's event loop otherwise survives a rejected setup promise.
    if (process.versions.electron) void import("electron").then(({ app }) => app.exit(1));
  });
}
