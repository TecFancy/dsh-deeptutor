/**
 * DeepTutor bridge: safety tiers for the generic `deeptutor_cli` passthrough.
 *
 * The passthrough exists so the plugin never has to mirror DeepTutor's command
 * surface: whatever the installed CLI offers is reachable, and the agent learns
 * it from `--help`. The price is that the plugin cannot know what a command it
 * has never seen does, so the default for anything unrecognised is "needs the
 * user's explicit go-ahead" rather than "run".
 *
 *   read     run right away: help, and commands whose verb only reads
 *   confirm  run only with confirm=true (writes, and every verb not listed here)
 *   blocked  never run: destructive verbs, and interactive / long-running
 *            commands that would hang a non-interactive tool call
 */

export type CliTier = "read" | "confirm" | "blocked";

export interface CliVerdict {
  tier: CliTier;
  reason: string;
}

/** Top-level commands that start a REPL, a server, a launcher or a setup wizard. */
const INTERACTIVE_TOP = new Set(["chat", "start", "stop", "serve", "init"]);

/** Verbs that only read. Matched against the subcommand (or a single-command top level). */
const READ_VERBS = new Set([
  "list",
  "show",
  "info",
  "search",
  "state",
  "status",
  "doctor",
  "get",
  "view",
]);

/** Verbs that delete, reset or roll back state, or need an interactive login. */
const BLOCKED_VERB =
  /^(delete|remove|remove-.+|clear|uninstall|rollback|purge|reset|drop|wipe|prune|login|logout)$/;

/** Commands the plugin's own tools run without confirmation; same rule here. */
const READ_TOP = new Set(["doctor", "run"]);

/** Leading positional words (the command path), stopping at the first option. */
export function commandPath(args: readonly string[]): string[] {
  const path: string[] = [];
  for (const a of args) {
    if (a.startsWith("-")) break;
    path.push(a);
  }
  return path;
}

/** Classify one `deeptutor <args>` invocation. Pure; unit-tested. */
export function classifyCliArgs(args: readonly string[]): CliVerdict {
  if (args.length === 0) {
    return { tier: "read", reason: "no arguments prints the top-level help" };
  }
  if (args.includes("--help") || args.includes("-h")) {
    return { tier: "read", reason: "--help only prints usage" };
  }
  const path = commandPath(args);
  const [top, sub] = path;
  if (!top) {
    return { tier: "confirm", reason: "options without a command" };
  }
  if (INTERACTIVE_TOP.has(top)) {
    return {
      tier: "blocked",
      reason: `\`deeptutor ${top}\` is interactive or long-running and would hang a tool call; run it in a terminal yourself`,
    };
  }
  for (const word of [top, sub]) {
    if (word && BLOCKED_VERB.test(word)) {
      return {
        tier: "blocked",
        reason: `\`${word}\` deletes, resets or logs in; run it in a terminal yourself if you really mean it`,
      };
    }
  }
  if (READ_TOP.has(top)) {
    return { tier: "read", reason: `\`deeptutor ${top}\` is a read-only or learning command` };
  }
  if (sub && (READ_VERBS.has(sub) || sub.startsWith("list-"))) {
    return { tier: "read", reason: `\`${sub}\` only reads` };
  }
  if (!sub && path.length === 1) {
    return {
      tier: "confirm",
      reason: `\`deeptutor ${top}\` without a subcommand; use --help to see what it does`,
    };
  }
  return {
    tier: "confirm",
    reason: `\`${[top, sub].filter(Boolean).join(" ")}\` may change DeepTutor state`,
  };
}
