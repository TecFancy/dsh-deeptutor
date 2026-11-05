/**
 * DeepTutor bridge: one learning "turn" — running a capability through the deeptutor CLI
 * (local or over SSH), JSONL event parsing and result formatting.
 */
import { truncate } from "./config.ts";
import { runCli } from "./cli-exec.ts";

export interface TurnResult {
  answer: string;
  errors: string[];
  toolCalls: string[];
  sessionId?: string;
  title?: string;
}

/** Fields cliRunTurn reads off the deeptutor_run tool params. */
export interface RunParams {
  prompt: string;
  capability: string;
  kbs?: string[];
  tools?: string[];
  session_id?: string;
  language?: string;
  config?: Record<string, unknown>;
}

/** Fold one CLI JSONL event into the running turn state. Exported for unit tests. */
export function collectEvent(state: TurnResult, e: any) {
  if (e.type === "content" && typeof e.content === "string") state.answer += e.content;
  else if (e.type === "result" && typeof e.metadata?.response === "string")
    state.answer = e.metadata.response;
  else if (e.type === "error")
    state.errors.push(typeof e.content === "string" ? e.content : JSON.stringify(e.metadata ?? ""));
  else if (e.type === "tool_call")
    state.toolCalls.push(
      typeof e.content === "string" ? e.content : String(e.metadata?.name ?? ""),
    );
  else if (e.type === "session_meta" && e.metadata?.title) state.title = e.metadata.title;
  if (!state.sessionId && typeof e.session_id === "string") state.sessionId = e.session_id;
}

/**
 * Build the `deeptutor run` argv for a capability turn (pure, unit-tested).
 * Scalar config values go as repeatable --config k=v; object/array values are
 * collected into --config-json (the CLI's documented form for complex config)
 * instead of being stringified into a k=<json> value that no parser expects.
 */
export function buildRunArgs(params: RunParams): string[] {
  const argv = ["run", params.capability, params.prompt, "--format", "json"];
  for (const kb of params.kbs ?? []) argv.push("--kb", kb);
  for (const t of params.tools ?? []) argv.push("--tool", t);
  if (params.session_id) argv.push("--session", params.session_id);
  if (params.language) argv.push("--language", params.language);
  const complexConfig: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params.config ?? {})) {
    if (typeof v === "object" && v !== null) complexConfig[k] = v;
    else argv.push("--config", `${k}=${v}`);
  }
  if (Object.keys(complexConfig).length > 0) {
    argv.push("--config-json", JSON.stringify(complexConfig));
  }
  return argv;
}

/** Execute one turn via the CLI (local or SSH). `run` is injectable for tests. */
export async function cliRunTurn(
  params: RunParams,
  timeoutMs: number,
  signal?: AbortSignal,
  run: typeof runCli = runCli,
): Promise<TurnResult> {
  const { stdout, stderr, code, killed } = await run(buildRunArgs(params), { signal, timeoutMs });
  if (killed) {
    // A kill can come from the user cancelling (signal) or from the timeout;
    // report the real reason instead of always blaming the timeout.
    throw new Error(
      signal?.aborted ? "Aborted" : `CLI execution timed out (${Math.round(timeoutMs / 1000)}s)`,
    );
  }
  if (code !== 0) throw new Error(`CLI exit=${code}: ${stderr || "(no stderr)"}`);
  const state: TurnResult = { answer: "", errors: [], toolCalls: [] };
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    let e: any;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    collectEvent(state, e);
  }
  return state;
}

export const fmtTurnResult = (capability: string, r: TurnResult, maxChars: number): string => {
  const parts: string[] = [];
  parts.push(`[deeptutor ${capability} done]`);
  if (r.sessionId)
    parts.push(
      `- session_id: ${r.sessionId} (pass session_id in later turns to continue this context)`,
    );
  if (r.title) parts.push(`- session title: ${r.title}`);
  if (r.toolCalls.length) parts.push(`- tools used: ${[...new Set(r.toolCalls)].join(", ")}`);
  if (r.errors.length)
    parts.push(`- note (some steps failed): ${r.errors.slice(0, 3).join(" | ")}`);
  parts.push(`\n===== Answer =====\n${truncate(r.answer || "(no answer)", maxChars)}`);
  return parts.join("\n");
};
