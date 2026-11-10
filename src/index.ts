/**
 * DeepTutor bridge plugin for DeepSeek Harness (dsh).
 *
 * Registers the host-neutral tools from src/tools.ts:
 *   - deeptutor_run  — execute a DeepTutor learning capability
 *   - deeptutor_kb   — list / search / info knowledge bases
 *   - deeptutor_note — archive a Markdown learning note to a server notebook
 *   - deeptutor_cli  — any other DeepTutor CLI command, behind safety tiers
 *
 * The same tools are served to MCP clients (Claude Code, …) by src/mcp.ts.
 *
 * Transport: every tool drives the deeptutor CLI.
 *   - Local: DEEPTUTOR_SSH_HOST unset → runs the local CLI (DEEPTUTOR_LOCAL_BIN).
 *   - Remote: DEEPTUTOR_SSH_HOST set → runs the server's CLI over SSH.
 *
 * Env config (agent-agnostic): DEEPTUTOR_SSH_HOST / DEEPTUTOR_LOCAL_BIN /
 * DEEPTUTOR_REMOTE_BIN / DEEPTUTOR_REMOTE_HOME — see src/config.ts and
 * .agents/skills/deeptutor/SKILL.md.
 */
import type { Context } from "@deepseek-ai/cordis";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { resolveHtmlDocScript } from "./html-render.ts";
import { TOOLS } from "./tools.ts";

export const name = "dsh-deeptutor";
export const inject = ["tools"] as const;

/** Drop undefined values so the canonical JSON value stays lossless-JSON. */
function json(o: Record<string, unknown>): { text: string } & Record<string, any> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out as { text: string };
}

const OUTPUT = {
  schema: {
    type: "object",
    properties: { text: { type: "string" } },
    additionalProperties: true,
  },
  render: (_args: unknown, value: { text?: string }) => [{ type: "text" as const, text: value.text ?? "" }],
} as const;

export function apply(ctx: Context) {
  const converter = resolveHtmlDocScript();
  console.log(
    `[dsh-deeptutor] plugin loaded (html-doc converter: ${converter.ok ? `${converter.path} (${converter.source})` : converter.error})`,
  );
  for (const tool of TOOLS) {
    ctx.tools.register(
      defineTool({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        output: OUTPUT,
        async execute(args, exec) {
          return json(await tool.execute(args as Record<string, any>, exec.signal)) as any;
        },
      }),
    );
  }
}
