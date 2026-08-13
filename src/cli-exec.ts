/**
 * DeepTutor bridge: CLI execution (local process or SSH), including the notebook
 * archiver's remote/local script plumbing.
 */
import { execFile, spawn } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEEPTUTOR_BIN, DEEPTUTOR_HOME, LOCAL_BIN, SSH_HOST } from "./config.ts";

export interface CliResult {
  stdout: string;
  stderr: string;
  code: number;
  killed: boolean;
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

/** Exec one command with optional abort + timeout, resolving instead of throwing. */
function execFileResolved(
  file: string,
  args: string[],
  opts: { signal?: AbortSignal; timeoutMs?: number; env?: Record<string, string> } = {},
): Promise<CliResult> {
  return new Promise((resolve) => {
    const child = execFile(
      file,
      args,
      {
        env: opts.env ? { ...process.env, ...opts.env } : process.env,
        windowsHide: true,
        timeout: opts.timeoutMs,
      },
      (err, stdout, stderr) => {
        const e: any = err;
        resolve({
          stdout: stdout ?? "",
          stderr: stderr ?? "",
          code: e ? (typeof e.code === "number" ? e.code : e.code === "ENOENT" ? 127 : 1) : 0,
          killed: e?.killed ?? false,
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

async function sshExec(
  argv: string[],
  opts: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<CliResult> {
  const payload = JSON.stringify({ argv, cwd: DEEPTUTOR_HOME });
  const script = [
    `export DEEPTUTOR_HOME=${DEEPTUTOR_HOME}`,
    "export DEEPTUTOR_SANDBOX_ALLOW_SUBPROCESS=1",
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
  };
}

/**
 * Unified CLI entry:
 *   - Remote deployment (SSH_HOST set) → execute on the server over SSH;
 *   - Local deployment (SSH_HOST empty) → execute DEEPTUTOR_LOCAL_BIN locally.
 * args are deeptutor subcommand args (without the program name).
 */
export async function runCli(
  args: string[],
  opts: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<CliResult> {
  if (SSH_HOST) {
    return sshExec([DEEPTUTOR_BIN, ...args], opts);
  }
  // Local mode: execute directly (force UTF-8 output to avoid Windows cp1252 console crashes)
  const res = await execFileResolved(
    LOCAL_BIN,
    args,
    { signal: opts.signal, timeoutMs: opts.timeoutMs, env: { PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" } },
  );
  const out = res.stdout ?? "";
  const [stdout, stderr] = out.split("__DT_STDERR__");
  return {
    stdout: stdout ?? "",
    stderr: (stderr ?? "").trim(),
    code: res.code,
    killed: res.killed,
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
