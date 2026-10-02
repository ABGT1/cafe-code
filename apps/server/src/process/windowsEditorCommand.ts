// @effect-diagnostics nodeBuiltinImport:off
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
  type BigIntStats,
} from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { resolveCommandPath } from "@cafecode/shared/shell";

const MAX_EDITOR_SHIM_BYTES = 16 * 1024;
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

export interface WindowsEditorCommand {
  readonly command: string;
  readonly argumentPrefix: readonly string[];
  readonly nodeMode: boolean;
}

export type WindowsEditorCommandResolution =
  | { readonly _tag: "Resolved"; readonly value: WindowsEditorCommand }
  | { readonly _tag: "Missing" }
  | { readonly _tag: "Unsupported" };

interface WindowsEditorShim {
  readonly executableName: string;
  readonly cliSegments: readonly string[];
}

/**
 * Interpret only the two upstream VS Code wrapper templates as data. Never
 * execute a batch script, expand an environment variable, or infer a command
 * from arbitrary batch syntax. VS Code's own CLI preserves its --goto handling
 * and removes Node mode before handing off to the GUI process.
 *
 * Official source inspected at immutable revision
 * 3105ef6d4409c52eeb18800eea5b5d40ac2c539a:
 * https://github.com/microsoft/vscode/blob/3105ef6d4409c52eeb18800eea5b5d40ac2c539a/resources/win32/bin/code.cmd
 * https://github.com/microsoft/vscode/blob/3105ef6d4409c52eeb18800eea5b5d40ac2c539a/resources/win32/versioned/bin/code.cmd
 * https://github.com/microsoft/vscode/blob/3105ef6d4409c52eeb18800eea5b5d40ac2c539a/src/vs/code/node/cli.ts
 */
export function parseWindowsEditorShim(source: string): WindowsEditorShim | null {
  if (Buffer.byteLength(source, "utf8") > MAX_EDITOR_SHIM_BYTES) return null;
  const lines = source
    .replace(/^\uFEFF/u, "")
    .trim()
    .split(/\r?\n/u);
  if (
    lines.length !== 7 ||
    lines[0]?.toLowerCase() !== "@echo off" ||
    lines[1]?.toLowerCase() !== "setlocal" ||
    lines[2]?.toLowerCase() !== "set vscode_dev=" ||
    lines[3]?.toLowerCase() !== "set electron_run_as_node=1" ||
    lines[5]?.toLowerCase() !== "if %errorlevel% neq 0 exit /b %errorlevel%" ||
    lines[6]?.toLowerCase() !== "endlocal"
  ) {
    return null;
  }

  // Both arguments must start at the exact selected shim's parent install
  // directory. Branded executable names may contain spaces and parentheses;
  // path separators, batch expansion, alternate streams, and shell operators
  // are not accepted as part of that basename. Versioned resources admit one
  // inert directory component only, never a traversal or arbitrary suffix.
  const invocation = lines[4]?.match(
    /^"%~dp0\.\.\\([A-Za-z0-9][A-Za-z0-9 ._()'-]*\.exe)" "%~dp0\.\.\\((?:[A-Za-z0-9][A-Za-z0-9._-]*\\)?resources\\app\\out\\cli\.js)" %\*$/iu,
  );
  if (!invocation?.[1] || !invocation[2]) return null;
  const executableName = invocation[1];
  const cliSegments = invocation[2].split("\\");
  if (
    executableName.includes("..") ||
    cliSegments.some((segment) => segment.includes("..") || segment.endsWith("."))
  ) {
    return null;
  }
  return { executableName, cliSegments };
}

function sameFile(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function unchangedFile(left: BigIntStats, right: BigIntStats): boolean {
  return (
    sameFile(left, right) &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

function isRegularFile(metadata: BigIntStats): boolean {
  return metadata.isFile() && !metadata.isSymbolicLink();
}

function readBoundedShim(
  shimPath: string,
): { readonly source: string; readonly metadata: BigIntStats } | null {
  const before = lstatSync(shimPath, { bigint: true });
  if (!isRegularFile(before) || before.size > BigInt(MAX_EDITOR_SHIM_BYTES)) return null;

  // Bound the actual read as well as the initial size: another process may
  // change the file between lstat and open. The descriptor must refer to that
  // same regular file, and its contents/identity must remain stable throughout
  // the read. O_NOFOLLOW adds native protection on hosts that implement it.
  const descriptor = openSync(shimPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fstatSync(descriptor, { bigint: true });
    if (!isRegularFile(opened) || !unchangedFile(before, opened)) return null;
    const buffer = Buffer.alloc(MAX_EDITOR_SHIM_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const count = readSync(descriptor, buffer, length, buffer.length - length, null);
      if (count === 0) break;
      length += count;
    }
    if (length > MAX_EDITOR_SHIM_BYTES) return null;
    const after = fstatSync(descriptor, { bigint: true });
    const published = lstatSync(shimPath, { bigint: true });
    if (
      !isRegularFile(published) ||
      !unchangedFile(opened, after) ||
      !unchangedFile(after, published)
    ) {
      return null;
    }
    return { source: utf8Decoder.decode(buffer.subarray(0, length)), metadata: after };
  } finally {
    closeSync(descriptor);
  }
}

function isRegularInstallFile(filePath: string, installRoot: string): boolean {
  const relativePath = relative(installRoot, filePath);
  if (
    relativePath.length === 0 ||
    isAbsolute(relativePath) ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`)
  ) {
    return false;
  }

  // Check every component below the canonical install root. A regular final
  // file alone is insufficient: a resources directory junction could redirect
  // the CLI into another installation or attacker-controlled script tree.
  const components = relativePath.split(sep);
  let current = installRoot;
  for (let index = 0; index < components.length; index += 1) {
    current = join(current, components[index]!);
    const metadata = lstatSync(current, { bigint: true });
    if (metadata.isSymbolicLink()) return false;
    if (index === components.length - 1 ? !metadata.isFile() : !metadata.isDirectory()) {
      return false;
    }
  }
  return true;
}

export function resolveWindowsEditorCommand(
  command: string,
  environment: NodeJS.ProcessEnv,
): WindowsEditorCommandResolution {
  const commandPath = resolveCommandPath(command, { platform: "win32", env: environment });
  if (commandPath === null) return { _tag: "Missing" };

  const extension = extname(commandPath).toLowerCase();
  // Native commands retain their existing direct launch and inherited
  // environment. Only batch commands need the narrowly admitted translation.
  if (extension === ".exe" || extension === ".com") {
    return {
      _tag: "Resolved",
      value: { command: commandPath, argumentPrefix: [], nodeMode: false },
    };
  }
  if (extension !== ".cmd") return { _tag: "Unsupported" };

  try {
    const selectedShim = resolve(commandPath);
    const binDirectory = dirname(selectedShim);
    const binMetadata = lstatSync(binDirectory, { bigint: true });
    if (!binMetadata.isDirectory() || binMetadata.isSymbolicLink()) {
      return { _tag: "Unsupported" };
    }
    const snapshot = readBoundedShim(selectedShim);
    const shim = snapshot === null ? null : parseWindowsEditorShim(snapshot.source);
    if (shim === null || snapshot === null) return { _tag: "Unsupported" };

    const installRoot = realpathSync(dirname(binDirectory));
    const canonicalShim = join(installRoot, basename(binDirectory), basename(selectedShim));
    const selectedMetadata = lstatSync(selectedShim, { bigint: true });
    const canonicalMetadata = lstatSync(canonicalShim, { bigint: true });
    if (
      !isRegularFile(selectedMetadata) ||
      !unchangedFile(snapshot.metadata, selectedMetadata) ||
      !sameFile(selectedMetadata, canonicalMetadata)
    ) {
      return { _tag: "Unsupported" };
    }
    const executablePath = join(installRoot, shim.executableName);
    const cliPath = join(installRoot, ...shim.cliSegments);
    if (
      !isRegularInstallFile(executablePath, installRoot) ||
      !isRegularInstallFile(cliPath, installRoot) ||
      !unchangedFile(snapshot.metadata, lstatSync(selectedShim, { bigint: true }))
    ) {
      return { _tag: "Unsupported" };
    }
    return {
      _tag: "Resolved",
      value: { command: executablePath, argumentPrefix: [cliPath], nodeMode: true },
    };
  } catch {
    // Discovery and launches share this admission. Unreadable, changed, or
    // unfamiliar wrappers are unsupported; never try a different installation,
    // replay them through cmd.exe, or expose their contents/filesystem errors.
    return { _tag: "Unsupported" };
  }
}

export function windowsEditorNodeEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const output = { ...environment };
  // Environment names are case-insensitive on Windows. Remove every spelling
  // before setting Node mode so a copied mixed-case key cannot win Node's
  // Windows environment serialization or resurrect the cleared VSCODE_DEV.
  for (const key of Object.keys(output)) {
    const normalized = key.toUpperCase();
    if (normalized === "VSCODE_DEV" || normalized === "ELECTRON_RUN_AS_NODE") delete output[key];
  }
  output.ELECTRON_RUN_AS_NODE = "1";
  return output;
}
