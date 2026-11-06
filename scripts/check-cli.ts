/**
 * Drift check against a live DeepTutor deployment: `npm run check:cli`.
 *
 * The plugin discovers capabilities and commands at runtime, so a new DeepTutor
 * release needs no plugin change, except when the few CLI shapes the dedicated
 * tools are built on change. This script checks exactly those shapes on the
 * deployment the DEEPTUTOR_* env vars point at, so a DeepTutor upgrade that
 * breaks the plugin shows up here before a tool call fails.
 *
 * On Windows run it from PowerShell or cmd: Git Bash (MSYS) rewrites
 * /home/... env values into C:/Program Files/Git/home/... before node sees them.
 */
import { runCli } from "../src/cli-exec.ts";
import { SSH_HOST } from "../src/config.ts";
import { parseModuleList } from "../src/discovery.ts";

interface Check {
  name: string;
  args: string[];
  /** Substrings that must appear in the output (Rich help tables are plain text inside). */
  expect?: string[];
  verify?: (stdout: string) => string | undefined;
}

const CHECKS: Check[] = [
  { name: "top-level commands", args: ["--help"], expect: ["run", "kb", "notebook", "module"] },
  {
    name: "run options (deeptutor_run)",
    args: ["run", "--help"],
    expect: ["--format", "--kb", "--tool", "--session", "--language", "--config", "--config-json"],
  },
  { name: "kb subcommands (deeptutor_kb)", args: ["kb", "--help"], expect: ["list", "info", "search"] },
  { name: "kb search options", args: ["kb", "search", "--help"], expect: ["--format", "--mode"] },
  { name: "notebook subcommands (deeptutor_note)", args: ["notebook", "--help"], expect: ["list", "create", "add-md"] },
  { name: "notebook add-md options", args: ["notebook", "add-md", "--help"], expect: ["--title", "--type"] },
  { name: "notebook create options", args: ["notebook", "create", "--help"], expect: ["--description"] },
  {
    name: "module list JSON (capability discovery)",
    args: ["module", "list"],
    verify: (out) => {
      const mods = parseModuleList(out);
      if (!mods) return "output is not a JSON array";
      if (!mods.some((m) => m.capabilities.length)) return "no module reports capabilities";
      return undefined;
    },
  },
  {
    name: "kb list JSON",
    args: ["kb", "list", "--format", "json"],
    verify: (out) => {
      try {
        JSON.parse(out);
        return undefined;
      } catch {
        return "output is not JSON";
      }
    },
  },
];

const env = { COLUMNS: "120", NO_COLOR: "1", TERM: "dumb" };
console.log(`Checking DeepTutor CLI (${SSH_HOST ? `remote via ${SSH_HOST}` : "local"})\n`);
let failed = 0;
for (const c of CHECKS) {
  const res = await runCli(c.args, { timeoutMs: 90_000, env });
  const out = res.stdout + "\n" + res.stderr;
  const problems: string[] = [];
  if (res.code !== 0) problems.push(`exit ${res.code}: ${res.stderr.trim().split("\n").slice(-3).join(" ")}`);
  for (const s of c.expect ?? []) if (!out.includes(s)) problems.push(`missing "${s}"`);
  const v = res.code === 0 ? c.verify?.(res.stdout) : undefined;
  if (v) problems.push(v);
  if (problems.length) {
    failed++;
    console.log(`✗ ${c.name}  (deeptutor ${c.args.join(" ")})\n    ${problems.join("\n    ")}`);
  } else {
    console.log(`✓ ${c.name}`);
  }
}
console.log(failed ? `\n${failed} check(s) failed: the plugin's CLI assumptions drifted.` : "\nAll checks passed.");
process.exit(failed ? 1 : 0);
