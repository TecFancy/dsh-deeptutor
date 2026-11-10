/**
 * DeepTutor bridge: CLI execution (local process or SSH), including the notebook
 * archiver's remote/local script plumbing.
 */
import { execFile, spawn } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEEPTUTOR_BIN, DEEPTUTOR_HOME, LOCAL_BIN, SSH_HOST } from "./config.ts";
import { resolveLocalCommand } from "./win-cmd.ts";

/**
 * Upper bound for one CLI run's captured stdout/stderr.
 *
 * `deeptutor run --format json` writes one JSON line per streamed chunk, and a
 * chunk is roughly one character of the answer once event metadata is included
 * (~1.5 KB of JSON per output character measured on 1.7.1). A 1500-character
 * answer is therefore ~2 MB, already past Node's 1 MB `execFile` default: the
 * child is killed mid-turn and the only trace is a string `err.code`
 * (`ERR_CHILD_PROCESS_STDIO_MAXBUFFER`) with empty stderr. 64 MB covers a
 * ~40k-character answer, well beyond the CLI's own per-turn token ceiling.
 */
export const MAX_CLI_OUTPUT_BYTES = 64 * 1024 * 1024;

export interface CliResult {
  stdout: string;
  stderr: string;
  code: number;
  killed: boolean;
  /** Node-level failure code, kept when stderr is empty so callers can report it. */
  error?: string;
}

/** Model-facing detail for a failed CLI run: stderr first, else the Node error code. */
export function describeCliFailure(res: Pick<CliResult, "stderr" | "error">): string {
  const stderr = (res.stderr ?? "").trim();
  if (stderr) return stderr;
  if (res.error === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER")
    return `output exceeded ${MAX_CLI_OUTPUT_BYTES} bytes (see MAX_CLI_OUTPUT_BYTES)`;
  return res.error || "(no stderr)";
}

// Remote runner: reads argv from a JSON file and executes without a shell (avoids all quoting/escaping).
const PY_RUNNER = [
  "import json, subprocess, sys",
  "a = json.load(open(sys.argv[1]))",
  "r = subprocess.run(a['argv'], capture_output=True, text=True, cwd=a.get('cwd'))",
  "sys.stdout.write(r.stdout)",
  "if r.stderr.strip():",
  "    sys.stdout.write('__DT_STDERR__' + r.stderr[-3000:])",
  "sys.exit(0 if r.returncode == 0 else 1)",
].join("\n");

// Remote notebook archiver (CLI fallback): ensure notebook exists → write temp md → add-md.
// NOTE: add-md takes the notebook ID as its first arg (passing a name silently "succeeds" without writing).
const PY_NOTE = [
  "import json, subprocess, sys",
  "a = json.load(open(sys.argv[1]))",
  "dt = a['dt']",
  "nb_id = None",
  "r = subprocess.run([dt, 'notebook', 'list'], capture_output=True, text=True)",
  "for line in r.stdout.splitlines():",
  "    parts = line.split('│')",
  "    if len(parts) >= 3 and parts[2].strip() == a['notebook']:",
  "        nb_id = parts[1].strip()",
  "        break",
  "if not nb_id:",
  "    r = subprocess.run([dt, 'notebook', 'create', a['notebook'], '--description', a['description']], capture_output=True, text=True)",
  "    try:",
  "        nb_id = json.loads(r.stdout)['id']",
  "    except Exception:",
  "        sys.stdout.write(r.stdout)",
  "        sys.exit(1)",
  "open(a['path'], 'w').write(a['content'])",
  "r = subprocess.run([dt, 'notebook', 'add-md', nb_id, a['path'], '--title', a['title'], '--type', a['type']], capture_output=True, text=True)",
  "sys.stdout.write(r.stdout)",
  "if r.stderr.strip():",
  "    sys.stdout.write('__DT_STDERR__' + r.stderr[-2000:])",
  "sys.exit(0 if r.returncode == 0 else 1)",
].join("\n");

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

/** Timeout for each notebook-archiver CLI step (list / create / add-md). */
const NOTE_STEP_TIMEOUT_MS = 30_000;

/** Exec one command with optional abort + timeout, resolving instead of throwing.
 *  Exported for tests: the captured-output ceiling is part of the contract. */
export function execFileResolved(
  file: string,
  args: string[],
  opts: {
    signal?: AbortSignal;
    timeoutMs?: number;
    env?: Record<string, string>;
    windowsVerbatimArguments?: boolean;
  } = {},
): Promise<CliResult> {
  return new Promise((resolve) => {
    const child = execFile(
      file,
      args,
      {
        env: opts.env ? { ...process.env, ...opts.env } : process.env,
        windowsHide: true,
        windowsVerbatimArguments: opts.windowsVerbatimArguments,
        timeout: opts.timeoutMs,
        maxBuffer: MAX_CLI_OUTPUT_BYTES,
      },
      (err, stdout, stderr) => {
        const e: any = err;
        resolve({
          stdout: stdout ?? "",
          stderr: stderr ?? "",
          code: e ? (typeof e.code === "number" ? e.code : e.code === "ENOENT" ? 127 : 1) : 0,
          killed: e?.killed ?? false,
          error: e && typeof e.code === "string" ? String(e.code) : undefined,
        });
      },
    );
    opts.signal?.addEventListener(
      "abort",
      () => {
        if (process.platform === "win32") {
          // child.kill() on Windows only kills the shell, not the process tree
          // (deeptutor CLI is a Python app; its subprocesses would linger)
          spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
        } else {
          child.kill();
        }
      },
      { once: true },
    );
  });
}

/** Options shared by every CLI invocation. */
export interface CliOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Extra env vars for the deeptutor process (names must match [A-Z_][A-Z0-9_]*). */
  env?: Record<string, string>;
}

const ENV_NAME = /^[A-Z_][A-Z0-9_]*$/;

/** `export K='v'` lines for the remote script; values are single-quote escaped. */
export function exportLines(env: Record<string, string> = {}): string[] {
  return Object.entries(env)
    .filter(([k]) => ENV_NAME.test(k))
    .map(([k, v]) => `export ${k}='${v.replace(/'/g, `'\\''`)}'`);
}

async function sshExec(argv: string[], opts: CliOptions = {}): Promise<CliResult> {
  const payload = JSON.stringify({ argv, cwd: DEEPTUTOR_HOME });
  const script = [
    `export DEEPTUTOR_HOME=${DEEPTUTOR_HOME}`,
    "export DEEPTUTOR_SANDBOX_ALLOW_SUBPROCESS=1",
    ...exportLines(opts.env),
    "F=/tmp/dt_pi_$$",
    `echo '${b64(payload)}' | base64 -d > "$F.json"`,
    `echo '${b64(PY_RUNNER)}' | base64 -d > "$F.py"`,
    `python3 "$F.py" "$F.json"`,
    "rc=$?",
    'rm -f "$F.json" "$F.py"',
    "exit $rc",
  ].join("\n");
  const remote = `echo '${b64(script)}' | base64 -d | bash`;
  const res = await execFileResolved(
    "ssh",
    ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", SSH_HOST, remote],
    { signal: opts.signal, timeoutMs: opts.timeoutMs ?? 600_000 },
  );
  const out = res.stdout ?? "";
  const [stdout, stderr] = out.split("__DT_STDERR__");
  return {
    stdout: stdout ?? "",
    stderr: (stderr ?? "").trim(),
    code: res.code ?? -1,
    killed: res.killed,
    error: res.error,
  };
}

/**
 * Unified CLI entry:
 *   - Remote deployment (SSH_HOST set) → execute on the server over SSH;
 *   - Local deployment (SSH_HOST empty) → execute DEEPTUTOR_LOCAL_BIN locally.
 * args are deeptutor subcommand args (without the program name).
 */
export async function runCli(args: string[], opts: CliOptions = {}): Promise<CliResult> {
  if (SSH_HOST) {
    return sshExec([DEEPTUTOR_BIN, ...args], opts);
  }
  // Local mode: execute directly (force UTF-8 output to avoid Windows cp1252 console crashes).
  // On Windows a .cmd/.bat LOCAL_BIN needs special handling (spawn EINVAL otherwise, issue #8).
  const cmd = resolveLocalCommand(LOCAL_BIN, args);
  if (cmd.error) return { stdout: "", stderr: cmd.error, code: 1, killed: false };
  const res = await execFileResolved(cmd.file, cmd.args, {
    signal: opts.signal,
    timeoutMs: opts.timeoutMs,
    env: { ...opts.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
    windowsVerbatimArguments: cmd.windowsVerbatimArguments,
  });
  const out = res.stdout ?? "";
  // Local mode is a direct execFile: the child's real stderr lands in res.stderr, and
  // the __DT_STDERR__ marker only exists on the ssh path (the remote Python runner
  // folds stderr into stdout). Splitting stdout still strips the marker if some wrapper
  // emits one, but res.stderr must win — reading only the split tail threw away every
  // Python traceback and reported "(no stderr)" for local runs (issue #20).
  const [stdout, wrapped] = out.split("__DT_STDERR__");
  const captured = (res.stderr ?? "").trim();
  return {
    stdout: stdout ?? "",
    stderr: captured || (wrapped ?? "").trim(),
    code: res.code,
    killed: res.killed,
    error: res.error,
  };
}

/** Local-deployment notebook archiver: list → parse ID → create → add-md */
export async function cliNoteLocal(
  nbName: string,
  title: string,
  recordType: string,
  content: string,
  signal?: AbortSignal,
): Promise<{ stdout: string; stderr: string; code: number }> {
  const list = await runCli(["notebook", "list"], { signal, timeoutMs: NOTE_STEP_TIMEOUT_MS });
  let nbId: string | undefined;
  for (const line of (list.stdout ?? "").split("\n")) {
    const parts = line.split("│");
    if (parts.length >= 3 && parts[2].trim() === nbName) {
      nbId = parts[1].trim();
      break;
    }
  }
  if (!nbId) {
    const created = await runCli(
      [
        "notebook",
        "create",
        nbName,
        "--description",
        `Archived by dsh agent (${new Date().toISOString().slice(0, 10)})`,
      ],
      { signal, timeoutMs: NOTE_STEP_TIMEOUT_MS },
    );
    let parsedId: unknown;
    try {
      parsedId = JSON.parse(created.stdout ?? "{}").id;
    } catch {
      return { stdout: created.stdout ?? "", stderr: created.stderr, code: created.code };
    }
    if (typeof parsedId !== "string") {
      return { stdout: created.stdout ?? "", stderr: created.stderr, code: created.code };
    }
    nbId = parsedId;
  }
  const tmp = join(tmpdir(), `dt_pi_note_${Date.now()}.md`);
  writeFileSync(tmp, content, "utf8");
  const add = await runCli(
    ["notebook", "add-md", nbId, tmp, "--title", title, "--type", recordType],
    { signal, timeoutMs: NOTE_STEP_TIMEOUT_MS },
  );
  rmSync(tmp, { force: true });
  return { stdout: add.stdout ?? "", stderr: add.stderr, code: add.code };
}

/** Remote-deployment notebook archiver (SSH CLI fallback): runs PY_NOTE on the server. */
export async function cliNoteRemote(
  nbName: string,
  title: string,
  recordType: string,
  content: string,
  signal?: AbortSignal,
): Promise<{ stdout: string; stderr: string; code: number }> {
  const path = `/tmp/dt_pi_note_${Date.now()}.md`;
  const payload = JSON.stringify({
    dt: DEEPTUTOR_BIN,
    notebook: nbName,
    description: `Archived by dsh agent (${new Date().toISOString().slice(0, 10)})`,
    title,
    type: recordType,
    content,
    path,
  });
  const script = [
    `export DEEPTUTOR_HOME=${DEEPTUTOR_HOME}`,
    "export DEEPTUTOR_SANDBOX_ALLOW_SUBPROCESS=1",
    "F=/tmp/dt_pi_note_$$",
    `echo '${b64(payload)}' | base64 -d > "$F.json"`,
    `echo '${b64(PY_NOTE)}' | base64 -d > "$F.py"`,
    `python3 "$F.py" "$F.json"`,
    "rc=$?",
    'rm -f "$F.json" "$F.py"',
    "exit $rc",
  ].join("\n");
  const remote = `echo '${b64(script)}' | base64 -d | bash`;
  const res = await execFileResolved(
    "ssh",
    ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", SSH_HOST, remote],
    { signal, timeoutMs: 60_000 },
  );
  const out = res.stdout ?? "";
  const [stdout, stderr] = out.split("__DT_STDERR__");
  return { stdout: stdout ?? "", stderr: (stderr ?? "").trim(), code: res.code ?? -1 };
}
