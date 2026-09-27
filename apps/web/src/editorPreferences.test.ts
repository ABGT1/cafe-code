import { describe, expect, it, vi } from "vitest";
import type { LocalApi, ServerConfig } from "@cafecode/contracts";

import { openInPreferredEditor } from "./editorPreferences";

function makeApi(defaultEditor: ServerConfig["clientSettings"]["defaultEditor"]) {
  const openPath = vi.fn(async () => undefined);
  const openInEditor = vi.fn(async () => undefined);
  const api = {
    server: {
      getConfig: vi.fn(async () => ({
        availableEditors: ["vscode"],
        clientSettings: { defaultEditor },
      })),
    },
    shell: { openPath, openInEditor },
  } as unknown as LocalApi;

  return { api, openPath, openInEditor };
}

describe("openInPreferredEditor", () => {
  it.each(["C:/repo/readme.md", "/Users/example/repo/readme.md", "/home/example/repo/readme.md"])(
    "uses the system association for %s",
    async (filePath) => {
      const { api, openPath, openInEditor } = makeApi("system-default");

      await expect(openInPreferredEditor(api, `${filePath}:12:3`)).resolves.toBe("file-manager");
      expect(openPath).toHaveBeenCalledWith(filePath);
      expect(openInEditor).not.toHaveBeenCalled();
    },
  );

  it.each(["C:/repo/readme.md", "/Users/example/repo/readme.md", "/home/example/repo/readme.md"])(
    "uses the configured editor for %s",
    async (filePath) => {
      const { api, openPath, openInEditor } = makeApi("vscode");

      await expect(openInPreferredEditor(api, `${filePath}:12:3`)).resolves.toBe("vscode");
      expect(openInEditor).toHaveBeenCalledWith(`${filePath}:12:3`, "vscode");
      expect(openPath).not.toHaveBeenCalled();
    },
  );
});
