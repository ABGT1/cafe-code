// @effect-diagnostics nodeBuiltinImport:off
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  parseWindowsEditorShim,
  resolveWindowsEditorCommand,
  windowsEditorNodeEnvironment,
} from "./windowsEditorCommand.ts";

function wrapper(executable = "Code - Insiders.exe", version?: string): string {
  return [
    "@echo off",
    "setlocal",
    "set VSCODE_DEV=",
    "set ELECTRON_RUN_AS_NODE=1",
    `"%~dp0..\\${executable}" "%~dp0..\\${version ? `${version}\\` : ""}resources\\app\\out\\cli.js" %*`,
    "IF %ERRORLEVEL% NEQ 0 EXIT /b %ERRORLEVEL%",
    "endlocal",
    "",
  ].join("\r\n");
}

function fixture(version?: string) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "cafe-windows-editor-admission-")));
  const installation = join(root, "Editor & %literal%! (fixture)");
  const bin = join(installation, "bin");
  const executable = join(installation, "Code - Insiders.exe");
  const cli = join(
    installation,
    ...(version ? [version] : []),
    "resources",
    "app",
    "out",
    "cli.js",
  );
  const shim = join(bin, "code-insiders.cmd");
  mkdirSync(bin, { recursive: true });
  mkdirSync(dirname(cli), { recursive: true });
  writeFileSync(executable, "synthetic native file metadata fixture");
  writeFileSync(cli, "synthetic CLI metadata fixture");
  writeFileSync(shim, wrapper("Code - Insiders.exe", version));
  return {
    root,
    installation,
    bin,
    executable,
    cli,
    shim,
    env: { PATH: bin, PATHEXT: ".EXE;.CMD" },
  };
}

function isWindowsSymlinkPrivilegeFailure(error: unknown): boolean {
  return (
    process.platform === "win32" &&
    error instanceof Error &&
    "code" in error &&
    error.code === "EPERM"
  );
}

describe("parseWindowsEditorShim", () => {
  it.each([undefined, "3105ef6d4409c52eeb18800eea5b5d40ac2c539a"])(
    "admits only the upstream executable/CLI template (version %s)",
    (version) => {
      expect(parseWindowsEditorShim(wrapper("Code - Insiders.exe", version))).toEqual({
        executableName: "Code - Insiders.exe",
        cliSegments: [...(version ? [version] : []), "resources", "app", "out", "cli.js"],
      });
      expect(
        parseWindowsEditorShim(`\uFEFF${wrapper("Code - Insiders.exe", version)}`),
      ).not.toBeNull();
    },
  );

  it.each([
    ["extra command", `${wrapper()}echo attacker\r\n`],
    ["changed Node mode", wrapper().replace("ELECTRON_RUN_AS_NODE=1", "ELECTRON_RUN_AS_NODE=0")],
    ["changed dev policy", wrapper().replace("VSCODE_DEV=", "VSCODE_DEV=1")],
    ["executable traversal", wrapper("..\\outside.exe")],
    ["executable expansion", wrapper("%ATTACKER%.exe")],
    ["alternate stream", wrapper("Code.exe:other.exe")],
    ["version traversal", wrapper("Code.exe", "..\\outside")],
    ["extra version component", wrapper("Code.exe", "a\\b")],
    ["version expansion", wrapper("Code.exe", "%ATTACKER%")],
    ["different CLI", wrapper().replace("cli.js", "other.js")],
    ["absolute CLI", wrapper().replace("%~dp0..\\resources", "C:\\resources")],
    ["command substitution", wrapper().replace(" %*", " %* & whoami")],
    ["oversized otherwise valid wrapper", `${" ".repeat(16 * 1024)}${wrapper()}`],
  ])("rejects %s without evaluating batch syntax", (_name, source) => {
    expect(parseWindowsEditorShim(source!)).toBeNull();
  });
});

describe("resolveWindowsEditorCommand", () => {
  it.each([undefined, "3105ef6d4409c52eeb18800eea5b5d40ac2c539a"])(
    "binds the exact PATH shim to its native executable and CLI (version %s)",
    (version) => {
      const files = fixture(version);
      try {
        expect(resolveWindowsEditorCommand("code-insiders", files.env)).toEqual({
          _tag: "Resolved",
          value: { command: files.executable, argumentPrefix: [files.cli], nodeMode: true },
        });
      } finally {
        rmSync(files.root, { recursive: true, force: true });
      }
    },
  );

  it("does not skip an unsupported first PATH installation for a later valid one", () => {
    const first = fixture();
    const second = fixture();
    try {
      writeFileSync(first.shim, "@echo off\r\nunknown-command %*\r\n");
      expect(
        resolveWindowsEditorCommand("code-insiders", {
          PATH: `${first.bin};${second.bin}`,
          PATHEXT: ".EXE;.CMD",
        }),
      ).toEqual({ _tag: "Unsupported" });
    } finally {
      rmSync(first.root, { recursive: true, force: true });
      rmSync(second.root, { recursive: true, force: true });
    }
  });

  it.each(["missing-executable", "directory-cli", "invalid-utf8", "oversized"])(
    "rejects %s admission without exposing filesystem errors or contents",
    (scenario) => {
      const files = fixture();
      try {
        if (scenario === "missing-executable") rmSync(files.executable);
        if (scenario === "directory-cli") {
          rmSync(files.cli);
          mkdirSync(files.cli);
        }
        if (scenario === "invalid-utf8") writeFileSync(files.shim, Buffer.from([0xff, 0xfe]));
        if (scenario === "oversized") {
          writeFileSync(files.shim, `${" ".repeat(16 * 1024)}${wrapper()}`);
        }
        expect(resolveWindowsEditorCommand("code-insiders", files.env)).toEqual({
          _tag: "Unsupported",
        });
      } finally {
        rmSync(files.root, { recursive: true, force: true });
      }
    },
  );

  it.for(["shim", "executable", "cli", "resources-directory"])(
    "rejects a symlinked %s rather than following it",
    (scenario, context) => {
      const files = fixture();
      const target = join(files.root, "outside-target");
      try {
        const link =
          scenario === "shim"
            ? files.shim
            : scenario === "executable"
              ? files.executable
              : scenario === "cli"
                ? files.cli
                : join(files.installation, "resources");
        rmSync(link, { recursive: true, force: true });
        if (scenario === "resources-directory") {
          mkdirSync(join(target, "app", "out"), { recursive: true });
          writeFileSync(join(target, "app", "out", "cli.js"), "outside script fixture");
        } else {
          writeFileSync(target, scenario === "shim" ? wrapper() : "outside file fixture");
        }
        try {
          symlinkSync(target, link, scenario === "resources-directory" ? "junction" : "file");
        } catch (error) {
          if (isWindowsSymlinkPrivilegeFailure(error)) {
            context.skip("Windows does not permit this specific symlink fixture.");
            return;
          }
          throw error;
        }
        expect(resolveWindowsEditorCommand("code-insiders", files.env)).toEqual({
          _tag: "Unsupported",
        });
      } finally {
        rmSync(files.root, { recursive: true, force: true });
      }
    },
  );

  it("retains direct native executable arguments and environment policy", () => {
    const files = fixture();
    const nativeCommand = join(files.bin, "code-insiders.EXE");
    try {
      writeFileSync(nativeCommand, "synthetic direct native executable fixture");
      expect(resolveWindowsEditorCommand("code-insiders", files.env)).toEqual({
        _tag: "Resolved",
        value: { command: nativeCommand, argumentPrefix: [], nodeMode: false },
      });
      expect(resolveWindowsEditorCommand("missing-editor-command", files.env)).toEqual({
        _tag: "Missing",
      });
    } finally {
      rmSync(files.root, { recursive: true, force: true });
    }
  });
});

describe("windowsEditorNodeEnvironment", () => {
  it("changes only the two wrapper keys and does not mutate the caller environment", () => {
    const environment = {
      PATH: "synthetic path",
      VSCODE_DEV: "1",
      vscode_dev: "other",
      ELECTRON_RUN_AS_NODE: "0",
      Electron_Run_As_Node: "other",
      CAFE_SYNTHETIC_VALUE: "retained",
    };
    expect(windowsEditorNodeEnvironment(environment)).toEqual({
      PATH: "synthetic path",
      ELECTRON_RUN_AS_NODE: "1",
      CAFE_SYNTHETIC_VALUE: "retained",
    });
    expect(environment.VSCODE_DEV).toBe("1");
    expect(environment.ELECTRON_RUN_AS_NODE).toBe("0");
  });
});
