// @effect-diagnostics nodeBuiltinImport:off
import { copyFile, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { expect, it } from "vitest";

import {
  resolveEditorLaunch,
  resolveEditorProcessLaunch,
} from "../src/process/externalLauncher.ts";

const enabled = process.platform === "win32" && process.env.CAFE_CODE_WINDOWS_EDITOR_E2E === "1";

/**
 * Native Windows argument qualification without installing or launching an
 * editor/provider or reading any real user profile. The admitted editor .exe is
 * an isolated copy of the pinned running Node executable; its synthetic cli.js
 * records argv and the two wrapper environment keys, then exits normally.
 * This qualifies Windows executable/argument serialization, not editor GUI UX.
 * Run explicitly with CAFE_CODE_WINDOWS_EDITOR_E2E=1 and the E2E Vitest config.
 */
it.skipIf(!enabled).each([undefined, "3105ef6d4409c52eeb18800eea5b5d40ac2c539a"])(
  "delivers Windows shim arguments unchanged through native spawning (version %s)",
  async (version) => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "cafe-windows-editor-native-")));
    const installation = join(root, "Editor & %literal%! (fixture)");
    const bin = join(installation, "bin");
    const executable = join(installation, "Code.exe");
    const cli = join(
      installation,
      ...(version ? [version] : []),
      "resources",
      "app",
      "out",
      "cli.js",
    );
    try {
      await mkdir(bin, { recursive: true });
      await mkdir(dirname(cli), { recursive: true });
      await copyFile(process.execPath, executable);
      await writeFile(
        cli,
        [
          "process.stdout.write(JSON.stringify({",
          "  argv: process.argv.slice(2),",
          "  nodeMode: process.env.ELECTRON_RUN_AS_NODE,",
          "  hasDevMode: Object.keys(process.env).some((key) => key.toUpperCase() === 'VSCODE_DEV')",
          "}));",
        ].join("\n"),
      );
      await writeFile(
        join(bin, "code.cmd"),
        [
          "@echo off",
          "setlocal",
          "set VSCODE_DEV=",
          "set ELECTRON_RUN_AS_NODE=1",
          `"%~dp0..\\Code.exe" "%~dp0..\\${version ? `${version}\\` : ""}resources\\app\\out\\cli.js" %*`,
          "IF %ERRORLEVEL% NEQ 0 EXIT /b %ERRORLEVEL%",
          "endlocal",
          "",
        ].join("\r\n"),
      );
      // The child receives only fixture directories and Windows system paths.
      // No inherited provider tokens, credentials, NODE_OPTIONS, or profiles
      // may enter this qualification. Mixed-case keys exercise Windows' native
      // case-insensitive environment serialization as well as hostile argv.
      const environment: NodeJS.ProcessEnv = {
        PATH: bin,
        PATHEXT: ".EXE;.CMD",
        HOME: root,
        USERPROFILE: root,
        APPDATA: root,
        LOCALAPPDATA: root,
        TEMP: root,
        TMP: root,
        SYSTEMROOT: process.env.SYSTEMROOT ?? process.env.SystemRoot,
        VSCODE_DEV: "1",
        vscode_dev: "other",
        Electron_Run_As_Node: "0",
      };
      const target = String.raw`C:\workspace\folder & %COMSPEC%! (review)\file "quoted" ^ name.md:42:7`;
      const launch = await Effect.runPromise(
        resolveEditorLaunch({ cwd: target, editor: "vscode" }, "win32", environment),
      );
      const plan = resolveEditorProcessLaunch(launch, "win32", environment);
      expect(plan.command).toBe(executable);
      expect(plan.args).toEqual([cli, "--goto", target]);
      expect(plan.options.shell).toBe(false);
      const output = await Effect.runPromise(
        Effect.gen(function* () {
          const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
          // Keep the production command, structured argv, detached policy,
          // and explicit environment. Only capture stdout so the synthetic CLI
          // can acknowledge delivery before scoped cleanup removes its files.
          return yield* spawner.string(
            ChildProcess.make(plan.command, plan.args, { ...plan.options, stdout: "pipe" }),
          );
        }).pipe(Effect.timeout("15 seconds"), Effect.scoped, Effect.provide(NodeServices.layer)),
      );
      expect(JSON.parse(output)).toEqual({
        argv: ["--goto", target],
        nodeMode: "1",
        hasDevMode: false,
      });
    } finally {
      // This test waits for the child's stdout retirement before cleanup. A
      // short Windows file-handle release delay is still possible after exit.
      await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  },
);
