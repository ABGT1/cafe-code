/**
 * Opt-in macOS Electron Dock regression smoke; run serially with other GUI tests:
 *
 * env -u ELECTRON_RUN_AS_NODE corepack yarn workspace @cafecode/desktop exec electron scripts/smoke-dictation-dock.mjs --run-native-test
 * Add --legacy to require reproduction of the previous process-wide Dock hide.
 *
 * Only synthetic main/panel windows and a private, temporary browser profile
 * are created. No Cafe startup, provider, microphone, clipboard, user document,
 * or remote page is used. Output contains fixed classifications and booleans;
 * raw exceptions and temporary profile paths are never printed.
 */
import { lstatSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const scriptPath = fileURLToPath(import.meta.url);
const delay = (milliseconds) => new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));

/** Importing this file for ordinary unit tests must not import Electron. */
export function parseDockSmokeArguments(args) {
  const { values, tokens } = parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    tokens: true,
    options: {
      "run-native-test": { type: "boolean" },
      legacy: { type: "boolean", default: false },
    },
  });
  if (values["run-native-test"] !== true) throw new Error("explicit_opt_in_required");
  const seen = new Set();
  for (const token of tokens) {
    if (token.kind !== "option" || seen.has(token.name)) throw new Error("invalid_arguments");
    seen.add(token.name);
  }
  return { legacy: values.legacy };
}

export function dockSmokeWorkspaceOptions(legacy) {
  // Keep fullscreen collection behavior identical. Only the old process-type
  // transformation is restored by the explicit negative-control switch.
  return { visibleOnFullScreen: true, ...(legacy ? {} : { skipTransformProcessType: true }) };
}

async function loadFixture(window, text) {
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  await window.loadURL(
    `data:text/html,${encodeURIComponent(`<meta http-equiv="Content-Security-Policy" content="default-src 'none'"><p>${text}</p>`)}`,
  );
}

async function main() {
  const options = parseDockSmokeArguments(process.argv.slice(2));
  if (process.platform !== "darwin" || !process.versions.electron)
    throw new Error("macos_electron_required");
  const { app, BrowserWindow, session } = await import("electron");
  const directory = mkdtempSync(join(tmpdir(), "cafecode-dictation-dock-"));
  const directoryIdentity = lstatSync(directory);
  let mainWindow;
  let panel;
  let finished = false;
  const result = {
    mode: options.legacy ? "legacy" : "fixed",
    passed: false,
    stage: "startup",
    dockPreserved: true,
    mainWindowPreserved: true,
    panelLifecyclePreserved: true,
    workspaceFlagPreserved: true,
    allCyclesCompleted: false,
    regressionObserved: false,
    cleanupSucceeded: false,
    observations: [],
  };
  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(deadline);
    if (panel && !panel.isDestroyed()) panel.destroy();
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
    try {
      // Delete only this run's exact mkdtemp directory, never a caller-supplied
      // path or a replacement/symlink installed at that pathname.
      const current = lstatSync(directory);
      if (
        current.isDirectory() &&
        !current.isSymbolicLink() &&
        current.dev === directoryIdentity.dev &&
        current.ino === directoryIdentity.ino
      ) {
        rmSync(directory, { recursive: true, force: false, maxRetries: 2, retryDelay: 50 });
        result.cleanupSucceeded = true;
      }
    } catch {
      // Report only cleanup outcome, not filesystem errors or private paths.
    }
    result.passed &&= result.cleanupSucceeded;
    console.log(JSON.stringify(result));
    app.exit(result.passed ? 0 : 1);
  };
  const deadline = setTimeout(() => {
    result.stage = "timeout";
    result.passed = false;
    finish();
  }, 30_000);

  try {
    app.setPath("userData", directory);
    app.setPath("sessionData", directory);
    app.commandLine.appendSwitch("disable-background-networking");
    app.commandLine.appendSwitch("disable-component-update");
    app.on("window-all-closed", () => {});
    await app.whenReady();
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) =>
      callback(false),
    );
    session.defaultSession.setPermissionCheckHandler(() => false);
    session.defaultSession.webRequest.onBeforeRequest({ urls: ["*://*/*"] }, (_details, callback) =>
      callback({ cancel: true }),
    );
    const webPreferences = { sandbox: true, contextIsolation: true, nodeIntegration: false };
    mainWindow = new BrowserWindow({
      width: 540,
      height: 360,
      show: false,
      title: "Synthetic Dock smoke",
      webPreferences,
    });
    await loadFixture(mainWindow, "Synthetic main window — no user data");
    await app.dock.show();
    mainWindow.showInactive();
    // Electron 42's DockHide intentionally no-ops within one second of
    // DockShow. Waiting beyond that grace period makes legacy a real control.
    await delay(1_250);
    if (!app.dock.isVisible() || !mainWindow.isVisible()) throw new Error("initial_visibility");

    const observe = async (cycle, phase, expectedVisible, destroyed = false) => {
      await delay(150);
      const dockVisible = app.dock.isVisible();
      const mainVisible = !mainWindow.isDestroyed() && mainWindow.isVisible();
      const panelMatches = destroyed
        ? panel.isDestroyed()
        : !panel.isDestroyed() && panel.isVisible() === expectedVisible;
      const workspaceVisible =
        destroyed || (!panel.isDestroyed() && panel.isVisibleOnAllWorkspaces());
      result.observations.push({
        cycle,
        phase,
        dockVisible,
        mainVisible,
        panelMatches,
        workspaceVisible,
      });
      result.dockPreserved &&= dockVisible;
      result.mainWindowPreserved &&= mainVisible;
      result.panelLifecyclePreserved &&= panelMatches;
      result.workspaceFlagPreserved &&= workspaceVisible;
      result.regressionObserved ||= !dockVisible;
    };
    for (const cycle of ["first", "second", "third"]) {
      result.stage = cycle;
      panel = new BrowserWindow({
        width: 490,
        height: 300,
        show: false,
        frame: false,
        type: "panel",
        skipTaskbar: true,
        fullscreenable: false,
        alwaysOnTop: true,
        webPreferences,
      });
      panel.setAlwaysOnTop(true, "floating");
      panel.setVisibleOnAllWorkspaces(true, dockSmokeWorkspaceOptions(options.legacy));
      await loadFixture(panel, "Synthetic dictation panel — no capture");
      await observe(cycle, "hidden", false);
      panel.showInactive();
      await observe(cycle, "passive", true);
      panel.show();
      panel.focus();
      await observe(cycle, "review", true);
      panel.hide();
      await observe(cycle, "hidden_after_review", false);
      panel.destroy();
      await observe(cycle, "destroyed", false, true);
    }
    result.allCyclesCompleted = true;
    result.passed =
      result.panelLifecyclePreserved &&
      result.workspaceFlagPreserved &&
      (options.legacy
        ? result.regressionObserved
        : result.dockPreserved && result.mainWindowPreserved);
    result.stage = "complete";
  } catch {
    result.passed = false;
  } finally {
    finish();
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === scriptPath) {
  void main().catch(() => {
    console.error("Dock smoke requires macOS Electron and --run-native-test; setup failed.");
    process.exitCode = 1;
    if (process.versions.electron) void import("electron").then(({ app }) => app.exit(1));
  });
}
