/**
 * DeepTutor bridge: the agent-facing tools, defined once and host-neutral.
 *
 * Two hosts adapt these specs:
 *   - dsh (src/index.ts) registers them through `defineTool`;
 *   - MCP clients such as Claude Code (src/mcp.ts) list and call them over stdio.
 *
 * Parameter specs use the dsh-tools shape (JSON-Schema-like, `required: true`
 * on the property) so dsh can infer argument types; `toJsonSchema` turns them
 * into plain JSON Schema for MCP.
 *
 * The four tools split the work like this:
 *   deeptutor_run   one learning turn (event folding, session reuse, HTML render)
 *   deeptutor_kb    list / search / info knowledge bases (hit formatting)
 *   deeptutor_note  archive Markdown to a notebook (find-or-create, file upload)
 *   deeptutor_cli   any other CLI command, discovered from --help, behind the
 *                   safety tiers in cli-policy.ts
 */
import { cliNoteLocal, cliNoteRemote, runCli } from "./cli-exec.ts";
import { classifyCliArgs } from "./cli-policy.ts";
import { configGuide, configHint, SSH_HOST, truncate } from "./config.ts";
import { describeCapabilities, discoverCapabilities } from "./discovery.ts";
import { renderHtml } from "./html-render.ts";
import { cliRunTurn, fmtTurnResult } from "./turn.ts";

interface Base {
  description: string;
  required?: true;
}
export type ParamSpec =
  | (Base & { type: "string"; enum?: readonly string[] })
  | (Base & { type: "number" })
  | (Base & { type: "boolean" })
  | (Base & { type: "array"; items: { type: "string" } })
  | (Base & { type: "object"; additionalProperties: true });

export type ParamsSpec = Record<string, ParamSpec>;

export interface ToolResultData {
  /** Text shown to the model. */
  text: string;
  /** Structured extras (session id, tool calls…); undefined values are dropped. */
  [key: string]: unknown;
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters: ParamsSpec;
  /** Throws an Error whose message is shown to the model on failure. */
  execute(args: Record<string, any>, signal: AbortSignal): Promise<ToolResultData>;
}

/** Plain JSON Schema (object) for one tool's parameters. Pure. */
export function toJsonSchema(params: ParamsSpec): {
  type: "object";
  properties: Record<string, unknown>;
  required: string[];
  additionalProperties: false;
} {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [key, spec] of Object.entries(params)) {
    const { required: isRequired, ...schema } = spec;
    properties[key] = schema;
    if (isRequired) required.push(key);
  }
  return { type: "object", properties, required, additionalProperties: false };
}

/** Required-parameter and basic type check (MCP clients may skip schema validation). Pure. */
export function validateArgs(params: ParamsSpec, args: Record<string, unknown>): string[] {
  const problems: string[] = [];
  for (const [key, spec] of Object.entries(params)) {
    const v = args[key];
    if (v === undefined || v === null) {
      if (spec.required) problems.push(`missing required parameter "${key}"`);
      continue;
    }
    const ok =
      spec.type === "array"
        ? Array.isArray(v) && v.every((x) => typeof x === "string")
        : spec.type === "object"
          ? typeof v === "object" && !Array.isArray(v)
          : typeof v === spec.type;
    if (!ok) problems.push(`parameter "${key}" must be ${spec.type === "array" ? "an array of strings" : `a ${spec.type}`}`);
    else if (spec.type === "string" && spec.enum && !spec.enum.includes(v as string))
      problems.push(`parameter "${key}" must be one of: ${spec.enum.join(", ")}`);
  }
  return problems;
}

// ---------- deeptutor_run ----------

const runTool: ToolSpec = {
  name: "deeptutor_run",
  description:
    "Execute one learning call on the DeepTutor service, e.g. deep_solve (in-depth explanation), deep_question (self-test questions), deep_research, chat, mastery_path (learning path), visualize. The capability set depends on the deployment and its installed modules: list it with deeptutor_cli args=[\"module\",\"list\"] (capabilities of modules that are ready). Can mount knowledge bases (kbs) and tools (rag, web_search, …; list them with deeptutor_cli args=[\"plugin\",\"list\"]). Returns the final answer plus session_id; pass session_id in later turns to continue the context.",
  parameters: {
    capability: {
      type: "string",
      required: true,
      description:
        "Capability name, e.g. deep_solve / deep_question / deep_research / chat / mastery_path / visualize. Not a fixed list: whatever the deployment's ready modules provide.",
    },
    prompt: {
      type: "string",
      required: true,
      description: "The learning question or instruction for this turn (e.g. explain the async/await state machine)",
    },
    kbs: {
      type: "array",
      items: { type: "string" },
      description: "Knowledge base names (check deeptutor_kb action=list first; never guess names)",
    },
    tools: {
      type: "array",
      items: { type: "string" },
      description: "Tools to enable, e.g. rag (KB retrieval), web_search, reason, brainstorm, code_execution",
    },
    session_id: {
      type: "string",
      description: "Session ID from a previous deeptutor_run call to continue that context",
    },
    config: {
      type: "object",
      additionalProperties: true,
      description:
        "Capability config key-values, e.g. num_questions=5 for deep_question, mode=report / depth=standard for deep_research",
    },
    language: { type: "string", description: "Response language code, default en; use zh for Chinese" },
    timeout: { type: "number", description: "Timeout in seconds, default 600; use 900+ for deep_research" },
    max_chars: { type: "number", description: "Max characters of the answer returned, default 30000" },
    html: {
      type: "string",
      description:
        "Optional output path for a self-contained local HTML render of the answer (also writes the companion .md next to it), e.g. data/study/abstract-class/knowledge.html. Relative paths resolve against the agent's working directory. Set it when the user wants browsable/printable study material.",
    },
    html_title: { type: "string", description: "HTML page title (default: derived from the html file name)" },
  },
  async execute(args, signal) {
    const timeoutMs = (args.timeout ?? 600) * 1000;
    const maxChars = args.max_chars ?? 30000;
    const capability = String(args.capability).trim();
    const index = await discoverCapabilities(signal).catch(() => undefined);
    const off = index?.unavailable[capability];
    if (off) {
      throw new Error(
        `[deeptutor_run] capability "${capability}" is not ready on this deployment ` +
          `(module ${off.module}: ${off.reason}).\n${describeCapabilities(index)}`,
      );
    }
    try {
      const r = await cliRunTurn({ ...args, capability } as any, timeoutMs, signal);
      const htmlNote = await renderHtml(args, r.answer);
      return {
        mode: "cli",
        sessionId: r.sessionId,
        toolCalls: r.toolCalls,
        errors: r.errors,
        text: configHint() + fmtTurnResult(capability, r, maxChars) + htmlNote,
      };
    } catch (err: any) {
      if (signal.aborted) throw new Error("[deeptutor_run cancelled]");
      const known = index && !index.ready.includes(capability) ? `\n${describeCapabilities(index)}` : "";
      throw new Error(configGuide() + `[deeptutor_run failed] ${err?.message ?? String(err)}${known}`);
    }
  },
};

// ---------- deeptutor_kb ----------

const kbTool: ToolSpec = {
  name: "deeptutor_kb",
  description:
    "Search DeepTutor knowledge bases: list all bases, search inside a base (RAG hit snippets), info for details. Search the user's personal knowledge bases before generating learning content and combine the hits with authoritative sources. Other kb commands (create, add, sources, eval…) go through deeptutor_cli.",
  parameters: {
    action: {
      type: "string",
      enum: ["list", "search", "info"],
      required: true,
      description: "What to do with the knowledge bases",
    },
    kb: { type: "string", description: "Knowledge base name (required for search/info)" },
    query: { type: "string", description: "Search question (required for search)" },
    mode: { type: "string", enum: ["hybrid", "dense", "sparse"], description: "Retrieval mode, default hybrid" },
    top_k: {
      type: "number",
      description: "Number of hits to return, default all (applied locally; the CLI has no --top-k flag)",
    },
    max_chars: { type: "number", description: "Max characters of the returned content, default 30000" },
  },
  async execute(args, signal) {
    const maxChars = args.max_chars ?? 30000;
    if ((args.action === "search" || args.action === "info") && !args.kb) {
      throw new Error(`[deeptutor_kb] action=${args.action} needs kb`);
    }
    if (args.action === "search" && !args.query) throw new Error("[deeptutor_kb] action=search needs query");
    let argv: string[];
    if (args.action === "list") argv = ["kb", "list", "--format", "json"];
    else if (args.action === "info") argv = ["kb", "info", args.kb];
    else argv = ["kb", "search", args.kb, args.query, "--format", "json", "--mode", args.mode ?? "hybrid"];
    const { stdout, stderr, code, killed } = await runCli(argv, { signal, timeoutMs: 90_000 });
    if (killed) throw new Error(configGuide() + "[deeptutor_kb timed out]");
    if (code !== 0) {
      throw new Error(
        `[deeptutor_kb failed] exit=${code}\nstderr: ${truncate(stderr || "(none)", 2000)}` + configGuide(),
      );
    }
    let body = stdout.trim() || "(empty result)";
    if (args.action === "search") body = formatSearch(stdout, args.top_k) ?? body;
    return { action: args.action, mode: "cli", kb: args.kb, query: args.query, text: truncate(body, maxChars) };
  },
};

/** Format `kb search --format json` output; undefined when it is not JSON. Exported for tests. */
export function formatSearch(stdout: string, topK?: number): string | undefined {
  let parsed: any;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return undefined;
  }
  const fmtHit = (s: any, i: number) => {
    const text = s.text ?? s.content ?? s.snippet ?? JSON.stringify(s);
    const src = s.source ?? s.doc_name ?? s.file ?? "";
    const title = s.title ? `  title: ${s.title}` : "";
    const score = typeof s.score === "number" ? `  score: ${s.score}` : "";
    return `[${i + 1}]${src ? `  source: ${src}` : ""}${title}${score}\n${typeof text === "string" ? text : JSON.stringify(text)}`;
  };
  // The CLI returns { query, answer, content, sources, provider }; older builds a bare array.
  if (Array.isArray(parsed)) {
    const hits = topK ? parsed.slice(0, topK) : parsed;
    return `${hits.length} hits:\n\n` + hits.map(fmtHit).join("\n\n");
  }
  if (parsed && typeof parsed === "object") {
    const parts: string[] = [];
    if (parsed.query) parts.push(`Query: ${parsed.query}`);
    if (typeof parsed.answer === "string" && parsed.answer.trim()) parts.push(`Answer: ${parsed.answer.trim()}`);
    const sources = Array.isArray(parsed.sources) ? parsed.sources : [];
    const hits = topK ? sources.slice(0, topK) : sources;
    parts.push(`${hits.length} hits:`);
    parts.push(hits.map(fmtHit).join("\n\n"));
    return parts.join("\n\n");
  }
  return undefined;
}

// ---------- deeptutor_note ----------

const noteTool: ToolSpec = {
  name: "deeptutor_note",
  description:
    "Archive a Markdown learning note (study plan, deep-solve summary, wrong answers, etc.) to a DeepTutor notebook (auto-creates the notebook if missing). Only when the user asks to save/archive notes.",
  parameters: {
    notebook: { type: "string", required: true, description: "Notebook name, e.g. dotnet-learning (auto-created if missing)" },
    title: { type: "string", required: true, description: "Record title" },
    type: {
      type: "string",
      enum: ["chat", "question", "research", "solve"],
      description: "Record type, default chat",
    },
    content: { type: "string", required: true, description: "Learning note content in Markdown" },
  },
  async execute(args, signal) {
    const recordType = (args.type ?? "chat") as string;
    const nbName = String(args.notebook).trim();
    const { stdout, stderr, code } = SSH_HOST
      ? await cliNoteRemote(nbName, args.title, recordType, args.content, signal)
      : await cliNoteLocal(nbName, args.title, recordType, args.content, signal);
    if (code !== 0) {
      throw new Error(`[deeptutor_note failed] exit=${code}\n${truncate(stderr || stdout, 2000)}` + configGuide());
    }
    return {
      notebook: nbName,
      title: args.title,
      mode: "cli",
      text:
        configHint() +
        `[note archived] notebook=${nbName}, title=${args.title}, type=${recordType}\n${truncate((stdout ?? "").trim(), 2000)}`,
    };
  },
};

// ---------- deeptutor_cli ----------

/**
 * Rich pads every line to the terminal width; drop that padding and blank-line
 * runs so wide output does not waste the model's context. Pure; exported for tests.
 */
export function tidyOutput(s: string): string {
  return s
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Wider than Rich's 80-column default so list tables keep more of each cell,
 * but not so wide that help boxes (which always span the full width) bloat.
 */
const CLI_ENV = { COLUMNS: "120", NO_COLOR: "1", TERM: "dumb" };

const cliTool: ToolSpec = {
  name: "deeptutor_cli",
  description:
    "Run any DeepTutor CLI command: `deeptutor <args>` (locally or over SSH, same as the other tools). Use it for everything the dedicated tools do not cover, and discover commands from the CLI itself instead of guessing: args=[\"--help\"], then [\"<command>\",\"--help\"]. Read-only commands (help, list/show/info/search/state/status, doctor, run) execute directly. Any other command may change DeepTutor state and needs confirm=true, which you may only set after the user explicitly asked for that change. Destructive commands (delete, remove, clear, uninstall, rollback…) and interactive ones (chat, start, serve, init, login) are refused; tell the user to run those in a terminal.",
  parameters: {
    args: {
      type: "array",
      items: { type: "string" },
      required: true,
      description: "Arguments after `deeptutor`, one per item, e.g. [\"kb\",\"list-sources\",\"dotnet\"] or [\"notebook\",\"show\",\"sqlserver-learning\"]",
    },
    confirm: {
      type: "boolean",
      description: "Set true only when the user explicitly asked for this state-changing command",
    },
    timeout: { type: "number", description: "Timeout in seconds, default 120" },
    max_chars: { type: "number", description: "Max characters of output returned, default 30000" },
  },
  async execute(args, signal) {
    const argv = (args.args as string[]).map(String);
    const verdict = classifyCliArgs(argv);
    const shown = `deeptutor ${argv.join(" ")}`.trim();
    if (verdict.tier === "blocked") throw new Error(`[deeptutor_cli refused] ${shown}: ${verdict.reason}`);
    if (verdict.tier === "confirm" && args.confirm !== true) {
      throw new Error(
        `[deeptutor_cli needs confirmation] ${shown}: ${verdict.reason}. ` +
          "Ask the user; retry with confirm=true only after they explicitly approve this command.",
      );
    }
    const maxChars = args.max_chars ?? 30000;
    const { stdout, stderr, code, killed } = await runCli(argv, {
      signal,
      timeoutMs: (args.timeout ?? 120) * 1000,
      env: CLI_ENV,
    });
    if (killed) throw new Error(signal.aborted ? "[deeptutor_cli cancelled]" : `[deeptutor_cli timed out] ${shown}`);
    const out = tidyOutput([stdout, stderr ? `--- stderr ---\n${stderr}` : ""].filter(Boolean).join("\n"));
    const text = `[${shown}] exit=${code}\n${truncate(out || "(no output)", maxChars)}`;
    if (code !== 0) throw new Error(code === 127 ? text + configGuide() : text);
    return { args: argv, tier: verdict.tier, exitCode: code, text };
  },
};

export const TOOLS: readonly ToolSpec[] = [runTool, kbTool, noteTool, cliTool];
