import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * End-to-end check of scripts/mcp-launch.mjs: spawn it the way pi and the Claude
 * Code plugin do, speak MCP over stdin/stdout, and close it.
 *
 * The in-process tests in mcp.test.ts cover the handler; this one covers what
 * those cannot — that the launcher picks a command that actually starts, that
 * the picked entry point resolves its imports, and that stdout carries protocol
 * only (a stray console.log in the launcher or in an imported module shows up
 * here as an unparsable line). The pi extension registers this same launcher,
 * so a regression breaks all three hosts at connect time.
 */
const launcher = fileURLToPath(new URL("../scripts/mcp-launch.mjs", import.meta.url));

interface Line {
  jsonrpc?: string;
  id?: number;
  result?: any;
  error?: { message?: string };
  method?: string;
}

test("the launcher speaks MCP: initialize and tools/list over stdio", async () => {
  const child = spawn(process.execPath, [launcher], { stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (d: string) => (stdout += d));
  child.stderr.setEncoding("utf8").on("data", (d: string) => (stderr += d));

  const send = (msg: unknown) => child.stdin.write(JSON.stringify(msg) + "\n");
  const waitFor = async (id: number): Promise<Line> => {
    const started = Date.now();
    while (Date.now() - started < 30_000) {
      for (const line of stdout.split("\n")) {
        if (!line.trim()) continue;
        let msg: Line;
        try {
          msg = JSON.parse(line);
        } catch {
          // A non-JSON line on stdout is a protocol violation, not a slow reply.
          assert.fail(`stdout carried a non-MCP line: ${line.slice(0, 200)}`);
        }
        if (msg.id === id) return msg;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.fail(`no reply to request ${id} within 30s; stderr: ${stderr.slice(-500)}`);
  };

  try {
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } } });
    const init = (await waitFor(1)).result;
    assert.equal(init.protocolVersion, "2025-06-18", "the server should echo the protocol version we asked for");
    assert.equal(init.serverInfo?.name, "dsh-deeptutor");
    assert.match(String(init.instructions), /DeepTutor/);

    send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    const tools = (await waitFor(2)).result.tools as Array<{ name: string; inputSchema: any }>;
    assert.deepEqual(
      tools.map((t) => t.name).sort(),
      ["deeptutor_cli", "deeptutor_kb", "deeptutor_note", "deeptutor_run"],
      "pi's tool_search and Claude Code's tool list both read these names",
    );
    for (const tool of tools) {
      assert.equal(tool.inputSchema.type, "object", `${tool.name} needs an object schema`);
      assert.ok(tool.inputSchema.properties && typeof tool.inputSchema.properties === "object");
    }
  } finally {
    child.stdin.end();
    child.kill();
  }
});
