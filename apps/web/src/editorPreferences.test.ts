import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorId, LocalApi, ServerConfig } from "@cafecode/contracts";

import { openInPreferredEditor } from "./editorPreferences";

const LAST_EDITOR_KEY = "cafe-code:last-editor";
const LEGACY_LAST_EDITOR_KEY = "cafecode:last-editor";
const FILE_PATHS = [
  "C:/repo/readme.md",
  "C:\\repo\\readme.md",
  "\\\\server\\share\\readme.md",
  "/Users/example/repo/readme.md",
  "/home/example/repo/readme.md",
] as const;

function makeApi(
  defaultEditor: ServerConfig["clientSettings"]["defaultEditor"],
  availableEditors: readonly EditorId[] = ["vscode"],
) {
  const openPath = vi.fn<LocalApi["shell"]["openPath"]>().mockResolvedValue(undefined);
  const openInEditor = vi.fn<LocalApi["shell"]["openInEditor"]>().mockResolvedValue(undefined);
  const confirm = vi.fn<LocalApi["dialogs"]["confirm"]>().mockResolvedValue(true);
  const getConfig = vi.fn<LocalApi["server"]["getConfig"]>().mockResolvedValue({
    availableEditors,
    clientSettings: { defaultEditor },
  } as ServerConfig);
  const api = {
    dialogs: { confirm },
    server: { getConfig },
    shell: { openPath, openInEditor },
  } as unknown as LocalApi;

  return { api, getConfig, openPath, openInEditor, confirm };
}

describe("openInPreferredEditor", () => {
  let storage: Storage;

  beforeEach(() => {
    const values = new Map<string, string>();
    storage = {
      clear: () => values.clear(),
      getItem: (key) => values.get(key) ?? null,
      key: (index) => [...values.keys()][index] ?? null,
      get length() {
        return values.size;
      },
      removeItem: (key) => values.delete(key),
      setItem: (key, value) => values.set(key, value),
    };
    vi.stubGlobal("window", { localStorage: storage });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each(FILE_PATHS)("uses the system association for %s", async (filePath) => {
    const { api, openPath, openInEditor, confirm } = makeApi("system-default");
    storage.setItem(LAST_EDITOR_KEY, JSON.stringify("vscode"));

    await expect(openInPreferredEditor(api, `${filePath}:12:3`)).resolves.toBe("file-manager");
    expect(openPath).toHaveBeenCalledExactlyOnceWith(filePath);
    expect(openInEditor).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  });

  it.each(FILE_PATHS)("keeps positions for the configured editor for %s", async (filePath) => {
    const { api, openPath, openInEditor, confirm } = makeApi("vscode", ["cursor", "vscode"]);
    storage.setItem(LAST_EDITOR_KEY, JSON.stringify("cursor"));

    await expect(openInPreferredEditor(api, `${filePath}:12:3`)).resolves.toBe("vscode");
    expect(openInEditor).toHaveBeenCalledExactlyOnceWith(`${filePath}:12:3`, "vscode");
    expect(openPath).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
    expect(storage.getItem(LAST_EDITOR_KEY)).toBe(JSON.stringify("cursor"));
  });

  it.each(["", ":12", ":12:3"])(
    "opens an association even when no editor is detected (position %s)",
    async (position) => {
      const { api, openPath, openInEditor } = makeApi("system-default", []);

      await expect(
        openInPreferredEditor(api, `C:\\repo\\a file (draft).md${position}`),
      ).resolves.toBe("file-manager");
      expect(openPath).toHaveBeenCalledExactlyOnceWith("C:\\repo\\a file (draft).md");
      expect(openInEditor).not.toHaveBeenCalled();
    },
  );

  it.each([
    "/repo/readme.md",
    "/repo/notes.txt",
    "/repo/source.ts",
    "/repo/component.tsx",
    "/repo/settings.json",
    "/repo/.cafe-code-system-prompt.md",
    "/repo/.cafe-code-keybindings.json",
    "/repo/program.exe/source.md",
    "C:\\repo\\README.MD. ",
  ])("keeps ordinary named document/source associations direct for %s", async (path) => {
    const { api, openPath, openInEditor, confirm } = makeApi("system-default");

    await expect(openInPreferredEditor(api, `${path}:12:3`)).resolves.toBe("file-manager");
    expect(confirm).not.toHaveBeenCalled();
    expect(openPath).toHaveBeenCalledExactlyOnceWith(path);
    expect(openInEditor).not.toHaveBeenCalled();
  });

  const potentialLaunchPaths = [
    "C:\\repo\\program.exe",
    "C:/repo/program.COM",
    "C:/repo/script.cmd",
    "C:/repo/script.bat",
    "C:/repo/script.ps1",
    "C:/repo/script.js",
    "C:/repo/script.vbs",
    "C:/repo/program.lnk",
    "C:/repo/program.url",
    "C:/repo/installer.msi",
    "C:/repo/package.msix",
    "C:/repo/program.exe. ",
    "\\\\server\\share\\program.cmd",
    "/home/example/program.desktop",
    "/home/example/program.AppImage",
    "/Users/example/Program.app",
    "/Users/example/Program.app/",
    "/Users/example/script.command",
    "/Users/example/action.workflow",
    "/repo/script.sh",
    "/repo/script.py",
    "/repo/program.jar",
    "/repo/command",
    "/repo/README",
    "/repo/.bashrc",
    "/repo/name.",
  ] as const;

  it.each(potentialLaunchPaths)(
    "does not open or replay a declined potentially runnable association for %s",
    async (path) => {
      const { api, openPath, openInEditor, confirm } = makeApi("system-default", []);
      confirm.mockResolvedValue(false);

      await expect(openInPreferredEditor(api, `${path}:12:3`)).resolves.toBeNull();
      expect(confirm).toHaveBeenCalledExactlyOnceWith(
        `The system default may run code or launch an application for this path:\n\n${path}\n\nOpen with the system default?`,
      );
      expect(openPath).not.toHaveBeenCalled();
      expect(openInEditor).not.toHaveBeenCalled();
    },
  );

  it.each(potentialLaunchPaths)(
    "opens the exact position-free path once after association consent for %s",
    async (path) => {
      const { api, openPath, openInEditor, confirm } = makeApi("system-default", []);

      await expect(openInPreferredEditor(api, `${path}:12:3`)).resolves.toBe("file-manager");
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(openPath).toHaveBeenCalledExactlyOnceWith(path);
      expect(confirm.mock.invocationCallOrder[0]).toBeLessThan(
        openPath.mock.invocationCallOrder[0]!,
      );
      expect(openInEditor).not.toHaveBeenCalled();
    },
  );

  it.each([
    "",
    "   ",
    "/repo/read\0me.md",
    "/repo/read\nme.md",
    "/repo/read\rme.md",
    "/repo/read\tme.md",
    "/repo/read\u007fme.md",
    "/repo/read\u0085me.md",
    "\\\\?\\C:\\repo\\readme.md",
    "\\\\.\\C:\\repo\\readme.md",
    "\\??\\C:\\repo\\readme.md",
    "//?/C:/repo/readme.md",
    "//./C:/repo/readme.md",
    "C:\\repo\\readme.md:program.exe",
    "C:/repo/readme.md::$DATA",
    "C:/repo/readme.md:1:2:3",
    "\\\\server\\share\\readme.md:program.exe",
  ])("rejects ambiguous/invalid association path %j before asking or opening", async (path) => {
    const { api, openPath, openInEditor, confirm } = makeApi("system-default");

    await expect(openInPreferredEditor(api, path)).rejects.toThrow(
      "The system default cannot open",
    );
    expect(confirm).not.toHaveBeenCalled();
    expect(openPath).not.toHaveBeenCalled();
    expect(openInEditor).not.toHaveBeenCalled();
  });

  it("does not reinterpret legal POSIX filename colons as Windows streams", async () => {
    const path = "/repo/review:notes.md";
    const { api, openPath, confirm } = makeApi("system-default");

    await expect(openInPreferredEditor(api, path)).resolves.toBe("file-manager");
    expect(openPath).toHaveBeenCalledExactlyOnceWith(path);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("keeps explicitly configured editors available for runnable source paths", async () => {
    const path = "C:/repo/script.js:12:3";
    const { api, openPath, openInEditor, confirm } = makeApi("vscode");

    await expect(openInPreferredEditor(api, path)).resolves.toBe("vscode");
    expect(openInEditor).toHaveBeenCalledExactlyOnceWith(path, "vscode");
    expect(confirm).not.toHaveBeenCalled();
    expect(openPath).not.toHaveBeenCalled();
  });

  it("does not open or replay an association if consent fails", async () => {
    const { api, openPath, openInEditor, confirm } = makeApi("system-default");
    const failure = new Error("Confirmation is unavailable");
    confirm.mockRejectedValue(failure);

    await expect(openInPreferredEditor(api, "/repo/program.sh")).rejects.toBe(failure);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(openPath).not.toHaveBeenCalled();
    expect(openInEditor).not.toHaveBeenCalled();
  });

  it("does not retry after an approved association fails to open", async () => {
    const { api, openPath, openInEditor, confirm } = makeApi("system-default");
    const failure = new Error("Application refused the path");
    openPath.mockRejectedValue(failure);

    await expect(openInPreferredEditor(api, "/repo/program.sh:12")).rejects.toBe(failure);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(openPath).toHaveBeenCalledExactlyOnceWith("/repo/program.sh");
    expect(openInEditor).not.toHaveBeenCalled();
  });

  it("uses an available remembered editor when the configured editor is unavailable", async () => {
    const { api, openPath, openInEditor } = makeApi("zed", ["cursor", "vscode"]);
    storage.setItem(LAST_EDITOR_KEY, JSON.stringify("vscode"));

    await expect(openInPreferredEditor(api, "/repo/readme.md:12:3")).resolves.toBe("vscode");
    expect(openInEditor).toHaveBeenCalledExactlyOnceWith("/repo/readme.md:12:3", "vscode");
    expect(openPath).not.toHaveBeenCalled();
  });

  it("migrates a valid legacy preference during unavailable-editor fallback", async () => {
    const { api, openInEditor } = makeApi("zed", ["cursor", "vscode"]);
    storage.setItem(LEGACY_LAST_EDITOR_KEY, JSON.stringify("vscode"));

    await expect(openInPreferredEditor(api, "/repo/readme.md")).resolves.toBe("vscode");
    expect(openInEditor).toHaveBeenCalledExactlyOnceWith("/repo/readme.md", "vscode");
    expect(storage.getItem(LAST_EDITOR_KEY)).toBe(JSON.stringify("vscode"));
    expect(storage.getItem(LEGACY_LAST_EDITOR_KEY)).toBeNull();
  });

  it.each([null, JSON.stringify("zed"), JSON.stringify("unregistered-editor"), "{broken"])(
    "falls back to and persists a detected editor for remembered value %s",
    async (remembered) => {
      const { api, openPath, openInEditor } = makeApi("zed", ["vscode", "cursor"]);
      if (remembered !== null) storage.setItem(LAST_EDITOR_KEY, remembered);

      await expect(openInPreferredEditor(api, "/repo/readme.md:12")).resolves.toBe("cursor");
      expect(openInEditor).toHaveBeenCalledExactlyOnceWith("/repo/readme.md:12", "cursor");
      expect(openPath).not.toHaveBeenCalled();
      expect(storage.getItem(LAST_EDITOR_KEY)).toBe(JSON.stringify("cursor"));
    },
  );

  it.each(["getItem", "setItem"] as const)(
    "does not let denied storage %s prevent an available fallback",
    async (operation) => {
      const { api, openInEditor } = makeApi("zed");
      vi.spyOn(storage, operation).mockImplementation(() => {
        throw new Error("Storage access denied");
      });

      await expect(openInPreferredEditor(api, "/repo/readme.md:12")).resolves.toBe("vscode");
      expect(openInEditor).toHaveBeenCalledExactlyOnceWith("/repo/readme.md:12", "vscode");
    },
  );

  it("does not launch an unavailable or unknown editor when none is detected", async () => {
    const { api, openPath, openInEditor } = makeApi("vscode", []);
    storage.setItem(LAST_EDITOR_KEY, JSON.stringify("unregistered-editor"));

    await expect(openInPreferredEditor(api, "/repo/readme.md")).rejects.toThrow(
      "No available editors found.",
    );
    expect(openPath).not.toHaveBeenCalled();
    expect(openInEditor).not.toHaveBeenCalled();
  });

  it("does not guess an editor when fetching configuration fails", async () => {
    const { api, getConfig, openPath, openInEditor } = makeApi("vscode");
    const failure = new Error("Configuration is unavailable");
    getConfig.mockRejectedValue(failure);

    await expect(openInPreferredEditor(api, "/repo/readme.md")).rejects.toBe(failure);
    expect(openPath).not.toHaveBeenCalled();
    expect(openInEditor).not.toHaveBeenCalled();
  });

  it.each(["system-default", "vscode"] as const)(
    "propagates %s launch failure without silently launching another application",
    async (defaultEditor) => {
      const { api, openPath, openInEditor } = makeApi(defaultEditor);
      const failure = new Error("Application refused the path");
      if (defaultEditor === "system-default") openPath.mockRejectedValue(failure);
      else openInEditor.mockRejectedValue(failure);

      await expect(openInPreferredEditor(api, "/repo/readme.md")).rejects.toBe(failure);
      expect(openPath).toHaveBeenCalledTimes(defaultEditor === "system-default" ? 1 : 0);
      expect(openInEditor).toHaveBeenCalledTimes(defaultEditor === "vscode" ? 1 : 0);
    },
  );
});
