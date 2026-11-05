/**
 * DeepTutor bridge: launching the local deeptutor CLI on Windows.
 *
 * Node's execFile cannot start a .cmd/.bat file directly on Windows (spawn EINVAL, see
 * issue #8), and it does not search PATHEXT for a bare command name. resolveLocalCommand
 * turns DEEPTUTOR_LOCAL_BIN into something execFile can run:
 *   1. a bare name is looked up on PATH using PATHEXT;
 *   2. a .cmd/.bat that only forwards its arguments to an .exe (`"C:\...\deeptutor.exe" %*`)
 *      is replaced by that .exe, so no shell is involved;
 *   3. any other .cmd/.bat runs through `cmd.exe /d /s /c` with every argument quoted and
 *      its metacharacters escaped (the same scheme as cross-spawn).
 * cmd.exe ends a command line at a newline, so case 3 cannot pass multi-line arguments;
 * resolveLocalCommand reports that instead of silently truncating the prompt.
 */
import { existsSync, readFileSync } from "node:fs";
import { extname, win32 } from "node:path";

export interface LocalCommand {
  file: string;
  args: string[];
  /** Pass the args to CreateProcess unchanged (needed for the cmd.exe command line). */
  windowsVerbatimArguments?: boolean;
  /** Set when the command cannot be run as requested; nothing should be spawned. */
  error?: string;
}

const META_CHARS = /([()\][%!^"`<>&|;, *?])/g;

/** Quote one argument for a cmd.exe command line (cross-spawn's escapeArgument). */
export function escapeCmdArgument(arg: string, doubleEscapeMetaChars: boolean): string {
  let out = arg.replace(/(\\*)"/g, '$1$1\\"');
  out = out.replace(/(\\*)$/, "$1$1");
  out = `"${out}"`;
  out = out.replace(META_CHARS, "^$1");
  if (doubleEscapeMetaChars) out = out.replace(META_CHARS, "^$1");
  return out;
}

/** Escape the command path itself for a cmd.exe command line. */
export function escapeCmdCommand(command: string): string {
  return command.replace(META_CHARS, "^$1");
}

/**
 * Build the `cmd.exe /d /s /c "..."` invocation for a batch file. Arguments are escaped
 * twice because a batch file that forwards `%*` makes cmd.exe parse them a second time.
 */
export function buildCmdInvocation(batchFile: string, args: string[], comSpec = "cmd.exe"): LocalCommand {
  const line = [escapeCmdCommand(batchFile), ...args.map((a) => escapeCmdArgument(a, true))].join(" ");
  return { file: comSpec, args: ["/d", "/s", "/c", `"${line}"`], windowsVerbatimArguments: true };
}

/**
 * If a .cmd/.bat wrapper does nothing but forward its arguments to an executable, return
 * that executable's path. Accepts `@echo off`, `rem`/`::` comments and `setlocal`/`endlocal`
 * around a single `["]<path>.exe["] %*` line; `%~dp0` is expanded to the wrapper's folder.
 */
export function parseCmdWrapper(text: string, wrapperPath: string): string | undefined {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(
      (l) =>
        l !== "" &&
        !/^@?echo\s+off$/i.test(l) &&
        !/^@?(rem(\s|$)|::)/i.test(l) &&
        !/^@?(setlocal|endlocal)(\s|$)/i.test(l),
    );
  if (lines.length !== 1) return undefined;
  const m = /^@?(?:"([^"]+\.(?:exe|com))"|([^\s"]+\.(?:exe|com)))\s+%\*$/i.exec(lines[0]);
  if (!m) return undefined;
  // Windows path rules regardless of the host, so this also behaves the same in Linux CI.
  const dir = win32.dirname(wrapperPath);
  const target = (m[1] ?? m[2]).replace(/%~dp0/gi, dir + "\\");
  if (/%/.test(target)) return undefined; // other variables: let cmd.exe expand them
  return win32.resolve(dir, target);
}

/** Find a bare command name on PATH, trying each PATHEXT extension (Windows search order). */
export function findOnPath(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
  exists: (p: string) => boolean = existsSync,
): string | undefined {
  const exts = (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean);
  // Windows path rules regardless of the host, so this also behaves the same in Linux CI.
  const dirs = (env.PATH ?? env.Path ?? "").split(win32.delimiter).filter(Boolean);
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = win32.join(dir.replace(/^"|"$/g, ""), name + ext.toLowerCase());
      if (exists(candidate)) return candidate;
    }
  }
  return undefined;
}

/** Turn a local CLI path plus argv into something execFile can start on this platform. */
export function resolveLocalCommand(
  file: string,
  args: string[],
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): LocalCommand {
  if (platform !== "win32") return { file, args };
  let target = file;
  const isBareName = !/[\\/]/.test(target) && extname(target) === "";
  if (isBareName) target = findOnPath(target, env) ?? target;
  if (!/\.(cmd|bat)$/i.test(target)) return { file: target, args };

  let wrapped: string | undefined;
  try {
    wrapped = parseCmdWrapper(readFileSync(target, "utf8"), target);
  } catch {
    wrapped = undefined;
  }
  if (wrapped && existsSync(wrapped)) return { file: wrapped, args };

  if (args.some((a) => /[\r\n]/.test(a))) {
    return {
      file: target,
      args,
      error:
        `${target} is a batch file, and cmd.exe cannot pass arguments that contain line breaks. ` +
        "Point DEEPTUTOR_LOCAL_BIN at deeptutor.exe instead (in a pip/venv install it is " +
        "<venv>\\Scripts\\deeptutor.exe).",
    };
  }
  return buildCmdInvocation(target, args, env.ComSpec ?? env.COMSPEC ?? "cmd.exe");
}
