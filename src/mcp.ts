/**
 * DeepTutor bridge: Model Context Protocol server over stdio.
 *
 * Serves the same tools as the dsh plugin (src/tools.ts) to MCP clients such as
 * Claude Code. Hand-rolled on purpose: the protocol surface a tools-only server
 * needs is small (initialize, ping, tools/list, tools/call, cancellation), and
 * keeping it in-house preserves the package's zero runtime dependencies.
 *
 * Transport: newline-delimited JSON-RPC 2.0 on stdin/stdout. stdout carries
 * protocol messages only; diagnostics go to stderr.
 */
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { TOOLS, toJsonSchema, validateArgs, type ToolSpec } from "./tools.ts";

const SUPPORTED_PROTOCOLS = ["2024-11-05", "2025-03-26", "2025-06-18"];
const LATEST_PROTOCOL = SUPPORTED_PROTOCOLS[SUPPORTED_PROTOCOLS.length - 1];

const INSTRUCTIONS =
  "DeepTutor learning tools. Explain topics with deeptutor_run (deep_solve, deep_question, …), " +
  "search the user's knowledge bases with deeptutor_kb before answering from memory, archive notes " +
  "with deeptutor_note only on request, and reach every other DeepTutor CLI command through " +
  "deeptutor_cli, discovering commands with args=[\"--help\"] rather than guessing.";

function packageVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

type Id = string | number;
interface Message {
  jsonrpc?: string;
  id?: Id | null;
  method?: string;
  params?: any;
}

export interface McpServerOptions {
  tools?: readonly ToolSpec[];
  /** Writes one serialized message (without the trailing newline). */
  send: (line: string) => void;
  log?: (msg: string) => void;
}

/**
 * Transport-free MCP message handler. `handle` takes one parsed message and
 * resolves once any response has been sent. Exported for tests.
 */
export function createMcpHandler(opts: McpServerOptions) {
  const tools = opts.tools ?? TOOLS;
  const byName = new Map(tools.map((t) => [t.name, t]));
  const inflight = new Map<Id, AbortController>();
  const log = opts.log ?? (() => {});
  const reply = (id: Id, result: unknown) => opts.send(JSON.stringify({ jsonrpc: "2.0", id, result }));
  const fail = (id: Id | null, code: number, message: string) =>
    opts.send(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }));

  async function callTool(id: Id, params: any) {
    const tool = byName.get(params?.name);
    if (!tool) return fail(id, -32602, `Unknown tool: ${String(params?.name)}`);
    const args = params?.arguments && typeof params.arguments === "object" ? params.arguments : {};
    const problems = validateArgs(tool.parameters, args);
    if (problems.length) {
      return reply(id, { content: [{ type: "text", text: `[${tool.name}] ${problems.join("; ")}` }], isError: true });
    }
    const ac = new AbortController();
    inflight.set(id, ac);
    try {
      const { text, ...data } = await tool.execute(args, ac.signal);
      const structured = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
      if (ac.signal.aborted) return; // cancelled: the client no longer expects a response
      reply(id, { content: [{ type: "text", text }], structuredContent: { text, ...structured } });
    } catch (err: any) {
      if (ac.signal.aborted) return;
      reply(id, { content: [{ type: "text", text: err?.message ?? String(err) }], isError: true });
    } finally {
      inflight.delete(id);
    }
  }

  async function handle(msg: Message): Promise<void> {
    if (!msg || typeof msg !== "object" || typeof msg.method !== "string") {
      // Responses to requests we never send, or garbage: ignore.
      return;
    }
    const isRequest = msg.id !== undefined && msg.id !== null;
    if (!isRequest) {
      if (msg.method === "notifications/cancelled") inflight.get(msg.params?.requestId)?.abort();
      return;
    }
    const id = msg.id as Id;
    switch (msg.method) {
      case "initialize": {
        const asked = msg.params?.protocolVersion;
        reply(id, {
          protocolVersion: SUPPORTED_PROTOCOLS.includes(asked) ? asked : LATEST_PROTOCOL,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "dsh-deeptutor", version: packageVersion() },
          instructions: INSTRUCTIONS,
        });
        return;
      }
      case "ping":
        reply(id, {});
        return;
      case "tools/list":
        reply(id, {
          tools: tools.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: toJsonSchema(t.parameters),
          })),
        });
        return;
      case "tools/call":
        await callTool(id, msg.params);
        return;
      default:
        log(`unsupported method: ${msg.method}`);
        fail(id, -32601, `Method not found: ${msg.method}`);
    }
  }

  return { handle, inflight };
}

/** Run the server on this process's stdin/stdout until stdin closes. */
export function startStdioServer() {
  const log = (m: string) => process.stderr.write(`[dsh-deeptutor mcp] ${m}\n`);
  const { handle } = createMcpHandler({ send: (line) => process.stdout.write(line + "\n"), log });
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on("line", (line) => {
    if (!line.trim()) return;
    let msg: Message;
    try {
      msg = JSON.parse(line);
    } catch {
      process.stdout.write(
        JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }) + "\n",
      );
      return;
    }
    handle(msg).catch((err) => log(`handler error: ${err?.stack ?? err}`));
  });
  rl.on("close", () => process.exit(0));
  log(`ready (v${packageVersion()}, ${process.env.DEEPTUTOR_SSH_HOST ? `remote via ${process.env.DEEPTUTOR_SSH_HOST}` : "local CLI"})`);
}
