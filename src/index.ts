/**
 * DeepTutor bridge plugin for DeepSeek Harness (dsh).
 *
 * Registers three model-facing tools:
 *   - deeptutor_run  — execute a DeepTutor learning capability
 *   - deeptutor_kb   — list / search / info knowledge bases
 *   - deeptutor_note — archive a Markdown learning note to a server notebook
 *
 * Transport: every tool drives the deeptutor CLI.
 *   - Local: DEEPTUTOR_SSH_HOST unset → runs the local CLI (DEEPTUTOR_LOCAL_BIN).
 *   - Remote: DEEPTUTOR_SSH_HOST set → runs the server's CLI over SSH.
 * The HTTP/WS API was dropped: DeepTutor 1.7 moved it off /api/v1 and put it behind
 * a login, so the old probe always 404'd and cost ~30s per call before the CLI ran anyway.
 *
 * Env config (agent-agnostic): DEEPTUTOR_SSH_HOST / DEEPTUTOR_LOCAL_BIN /
 * DEEPTUTOR_REMOTE_BIN / DEEPTUTOR_REMOTE_HOME — see src/config.ts and
 * .agents/skills/deeptutor/SKILL.md.
 */
import type { Context } from "@deepseek-ai/cordis";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { CAPABILITIES, configGuide, configHint, SSH_HOST, truncate } from "./config.ts";
import { cliNoteLocal, cliNoteRemote, runCli } from "./cli-exec.ts";
import { renderHtml } from "./html-render.ts";
import { cliRunTurn, fmtTurnResult } from "./turn.ts";
import { HTML_DOC_SCRIPT } from "./html-render.ts";

export const name = "dsh-deeptutor";
export const inject = ["tools"] as const;

/** Drop keys whose value is `undefined` so the canonical JSON value stays lossless-JSON. */
type Jsonify<T extends Record<string, unknown>> = {
  [K in keyof T as T[K] extends undefined ? never : K]: Exclude<T[K], undefined>;
};
function json<T extends Record<string, unknown>>(o: T): Jsonify<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out as Jsonify<T>;
}

export function apply(ctx: Context) {
  console.log(`[dsh-deeptutor] plugin loaded (html script: ${HTML_DOC_SCRIPT})`);

  // ---------- Tool 1: run a DeepTutor learning capability ----------
  ctx.tools.register(
    defineTool({
      name: "deeptutor_run",
      description:
        "Execute one learning call on the DeepTutor service: deep_solve (in-depth explanation), deep_question (generate self-test questions), deep_research (deep research), chat (conversation), mastery_path (learning path planning), visualize / math_animator (visualization). Can mount knowledge bases (kbs) and tools (tools like rag / web_search). Returns the final answer plus session_id; pass session_id in later turns to continue the context (inherits chat history, knowledge bases and tools).",
      parameters: {
        capability: {
          type: "string",
          enum: [...CAPABILITIES],
          required: true,
          description: "The learning capability to run",
        },
        prompt: {
          type: "string",
          required: true,
          description:
            "The learning question or instruction for this turn (e.g. explain the async/await state machine)",
        },
        kbs: {
          type: "array",
          items: { type: "string" },
          description:
            "Knowledge base names (check deeptutor_kb list for available ones, e.g. the user's dotnet/sqlserver bases)",
        },
        tools: {
          type: "array",
          items: { type: "string" },
          description:
            "Tools to enable: rag (KB retrieval), web_search, reason, brainstorm, paper_search, code_execution, read_source, etc.",
        },
        session_id: {
          type: "string",
          description:
            "Session ID from a previous deeptutor_run call to continue that context",
        },
        config: {
          type: "object",
          additionalProperties: true,
          description:
            "Capability config key-values, e.g. num_questions=5 for deep_question, mode=report / depth=standard for deep_research",
        },
        language: {
          type: "string",
          description: "Response language code, default en; use zh for Chinese",
        },
        timeout: {
          type: "number",
          description: "Timeout in seconds, default 600; use 900+ for deep_research",
        },
        max_chars: {
          type: "number",
          description:
            "Max characters of the answer returned to the model, default 30000",
        },
        html: {
          type: "string",
          description:
            "Optional output path for a self-contained local HTML render of the answer (bundled md-to-html converter; also writes the companion .md source next to it). e.g. data/study/abstract-class/knowledge.html — open the HTML in a browser to read comfortably. Set it when the user wants browsable/printable study material.",
        },
        html_title: {
          type: "string",
          description:
            "HTML page title (default: derived from the html output file name)",
        },
      },
      output: {
        schema: {
          type: "object",
          properties: {
            mode: { type: "string" },
            sessionId: { type: "string" },
            answer: { type: "string" },
            toolCalls: { type: "array", items: { type: "string" } },
            errors: { type: "array", items: { type: "string" } },
            text: { type: "string" },
          },
          additionalProperties: true,
        },
        render: (_args, value) => [{ type: "text", text: value.text ?? "" }],
      },
      async execute(args, exec) {
        const timeoutMs = (args.timeout ?? 600) * 1000;
        const maxChars = args.max_chars ?? 30000;
        try {
          const r = await cliRunTurn(args, timeoutMs, exec.signal);
          const htmlNote = await renderHtml(args, r.answer);
          return json({
            mode: "cli",
            sessionId: r.sessionId,
            toolCalls: r.toolCalls,
            errors: r.errors,
            text:
              configHint() + fmtTurnResult(args.capability, r, maxChars) + htmlNote,
          });
        } catch (err: any) {
          if (exec.signal.aborted) {
            // user cancelled mid-CLI-run: report it as a cancellation, not a failure
            throw new Error("[deeptutor_run cancelled]");
          }
          throw new Error(
            configGuide() +
              `[deeptutor_run failed] ${err?.message ?? String(err)}`,
          );
        }
      },
    }),
  );

  // ---------- Tool 2: knowledge base operations ----------
  ctx.tools.register(
    defineTool({
      name: "deeptutor_kb",
      description:
        "Manage/search DeepTutor knowledge bases: list all bases, search inside a base (RAG hit snippets), info for details. Works in both local and remote deployments. Search the user's personal knowledge bases before generating learning content and combine the hits with authoritative sources.",
      parameters: {
        action: {
          type: "string",
          enum: ["list", "search", "info"],
          required: true,
          description: "What to do with the knowledge bases",
        },
        kb: {
          type: "string",
          description: "Knowledge base name (required for search/info)",
        },
        query: {
          type: "string",
          description:
            "Search question (required for search, e.g. C# generics covariance/contravariance)",
        },
        mode: {
          type: "string",
          enum: ["hybrid", "dense", "sparse"],
          description: "Retrieval mode, default hybrid",
        },
        top_k: {
          type: "number",
          description:
            "Number of hits to return, default 5 (applied locally to the CLI search result; the deeptutor CLI has no --top-k flag)",
        },
        max_chars: {
          type: "number",
          description:
            "Max characters of the returned content, default 30000",
        },
      },
      output: {
        schema: {
          type: "object",
          properties: {
            action: { type: "string" },
            mode: { type: "string" },
            kb: { type: "string" },
            query: { type: "string" },
            text: { type: "string" },
          },
          additionalProperties: true,
        },
        render: (_args, value) => [{ type: "text", text: value.text ?? "" }],
      },
      async execute(args, exec) {
        const maxChars = args.max_chars ?? 30000;
        // Local or SSH CLI. NOTE: `kb search` has no --top-k flag
        // (verified on deeptutor CLI 1.5.x); top_k is applied locally below.
        let argv: string[];
        if (args.action === "list") {
          argv = ["kb", "list", "--format", "json"];
        } else if (args.action === "info") {
          argv = ["kb", "info", args.kb ?? ""];
        } else {
          argv = [
            "kb",
            "search",
            args.kb ?? "",
            args.query ?? "",
            "--format",
            "json",
            "--mode",
            args.mode ?? "hybrid",
          ];
        }
        const { stdout, stderr, code, killed } = await runCli(argv, {
          signal: exec.signal,
          timeoutMs: 90_000,
        });
        if (killed) throw new Error(configGuide() + "[deeptutor_kb timed out]");
        if (code !== 0) {
          throw new Error(
            `[deeptutor_kb failed] exit=${code}\nstderr: ${truncate(stderr || "(none)", 2000)}` +
              configGuide(),
          );
        }
        let body = stdout.trim() || "(empty result)";
        if (args.action === "search") {
          try {
            const parsed = JSON.parse(stdout);
            const fmtHit = (s: any, i: number) => {
              const text = s.text ?? s.content ?? s.snippet ?? JSON.stringify(s);
              const src = s.source ?? s.doc_name ?? s.file ?? "";
              const title = s.title ? `  title: ${s.title}` : "";
              const score = typeof s.score === "number" ? `  score: ${s.score}` : "";
              return `[${i + 1}]${src ? `  source: ${src}` : ""}${title}${score}\n${typeof text === "string" ? text : JSON.stringify(text)}`;
            };
            // Current deeptutor CLI (1.5.x) returns an object
            // { query, answer, content, sources, provider }; older builds
            // returned a bare array of hits. Accept both.
            if (Array.isArray(parsed)) {
              const hits = args.top_k ? parsed.slice(0, args.top_k) : parsed;
              body = `${hits.length} hits:\n\n` + hits.map(fmtHit).join("\n\n");
            } else if (parsed && typeof parsed === "object") {
              const parts: string[] = [];
              if (parsed.query) parts.push(`Query: ${parsed.query}`);
              if (typeof parsed.answer === "string" && parsed.answer.trim())
                parts.push(`Answer: ${parsed.answer.trim()}`);
              const sources = Array.isArray(parsed.sources) ? parsed.sources : [];
              const hits = args.top_k ? sources.slice(0, args.top_k) : sources;
              parts.push(`${hits.length} hits:`);
              parts.push(hits.map(fmtHit).join("\n\n"));
              body = parts.join("\n\n");
            }
          } catch {
            /* non-JSON output returned as-is */
          }
        }
        return json({
          action: args.action,
          mode: "cli",
          kb: args.kb,
          query: args.query,
          text: truncate(body, maxChars),
        });
      },
    }),
  );

  // ---------- Tool 3: archive learning notes to a server notebook ----------
  ctx.tools.register(
    defineTool({
      name: "deeptutor_note",
      description:
        "Archive a Markdown learning note (study plan, deep-solve summary, wrong answers, etc.) to a DeepTutor notebook (auto-creates the notebook if missing). Record type: chat / question / research / solve.",
      parameters: {
        notebook: {
          type: "string",
          required: true,
          description:
            "Notebook name, e.g. dotnet-learning (auto-created if missing)",
        },
        title: {
          type: "string",
          required: true,
          description: "Record title, e.g. async/await state machine deep-dive notes",
        },
        type: {
          type: "string",
          enum: ["chat", "question", "research", "solve"],
          description: "Record type, default chat",
        },
        content: {
          type: "string",
          required: true,
          description: "Learning note content in Markdown",
        },
      },
      output: {
        schema: {
          type: "object",
          properties: {
            notebook: { type: "string" },
            nbId: { type: "string" },
            title: { type: "string" },
            mode: { type: "string" },
            text: { type: "string" },
          },
          additionalProperties: true,
        },
        render: (_args, value) => [{ type: "text", text: value.text ?? "" }],
      },
      async execute(args, exec) {
        const recordType = (args.type ?? "chat") as string;
        const nbName = args.notebook.trim();
        // Remote deployment runs the PY_NOTE script on the server; local deployment runs locally
        const { stdout, stderr, code } = SSH_HOST
          ? await cliNoteRemote(nbName, args.title, recordType, args.content, exec.signal)
          : await cliNoteLocal(nbName, args.title, recordType, args.content, exec.signal);
        if (code !== 0) {
          throw new Error(
            `[deeptutor_note failed] exit=${code}\n${truncate(stderr || stdout, 2000)}` +
              configGuide(),
          );
        }
        return json({
          notebook: nbName,
          title: args.title,
          mode: "cli",
          text:
            configHint() +
            `[note archived] notebook=${nbName}, title=${args.title}, type=${recordType}\n${truncate((stdout ?? "").trim(), 2000)}`,
        });
      },
    }),
  );
}
