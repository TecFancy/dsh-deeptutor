import { fileURLToPath } from "node:url";

/**
 * Pi (pi-coding-agent) extension: serves the DeepTutor tools to pi.
 *
 * pi has no bundle mechanism like dsh and no plugin marketplace like Claude Code,
 * so this extension is the pi entry point: it registers the same MCP server the
 * Claude Code plugin runs (scripts/mcp-launch.mjs), which serves the four tools
 * defined once in src/tools.ts. Nothing about the tools changes here — the whole
 * file is the host adapter, next to src/index.ts (dsh) and src/mcp.ts (MCP).
 *
 * Registering instead of shipping a mcp.json has one reason: pi loads the two
 * skills from .agents/skills and the server from the same package install, so a
 * user needs one `pi install` and no hand-written config.
 *
 * `timeout` is raised deliberately. pi's default per-request timeout is 60s with
 * progress notifications resetting it; this MCP server sends none, and a
 * deep_solve turn on a 1.7 deployment routinely runs for minutes. 30 minutes
 * matches the order of the CLI's own per-turn ceiling.
 */

/**
 * The slice of pi's `ExtensionAPI` this extension uses, declared locally.
 *
 * Importing `@earendil-works/pi-coding-agent` instead would drag a ~24 MB host
 * package into devDependencies, and declaring it as a peerDependency would make
 * npm auto-install pi for every dsh user. The package stays dependency-free on
 * purpose (the Claude Code plugin runs src/ from a git checkout without
 * `npm install`), so the one method is typed by hand. tests/pi-extension.test.ts
 * pins the shape.
 */
interface PiExtensionApi {
  registerMcpServer(
    name: string,
    config: {
      command: string;
      args?: string[];
      description?: string;
      exposure?: "codemode" | "deferred" | "direct" | "hidden";
      timeout?: number;
    },
  ): void;
}

/** The MCP server name pi shows in `/mcp` and prefixes its tools with. */
export const MCP_SERVER_NAME = "deeptutor";

/** One learning turn can outlast pi's 60s default by a wide margin. */
export const MCP_TIMEOUT_SECONDS = 30 * 60;

/** Absolute path of the launcher, resolved from this file so installs move cleanly. */
export const LAUNCHER = new URL("../scripts/mcp-launch.mjs", import.meta.url);

export default function deeptutorExtension(pi: PiExtensionApi): void {
  pi.registerMcpServer(MCP_SERVER_NAME, {
    // pi's own Node: the launcher decides between lib/, src/ and npx from there.
    command: process.execPath,
    args: [fileURLToPath(LAUNCHER)],
    description:
      "DeepTutor learning assistant: in-depth explanations, self-test questions, learning paths, personal knowledge-base search (RAG) and note archiving.",
    // `deferred` keeps the four large schemas out of every request until the
    // model searches for them, then lets it call them directly. pi's default,
    // `codemode`, would force a script for every call.
    exposure: "deferred",
    timeout: MCP_TIMEOUT_SECONDS,
  });
}
