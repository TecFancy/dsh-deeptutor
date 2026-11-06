import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createMcpHandler } from "../src/mcp.ts";
import { TOOLS, tidyOutput, toJsonSchema, validateArgs, type ToolSpec } from "../src/tools.ts";

test("tidyOutput strips Rich line padding and collapses blank runs", () => {
  assert.equal(tidyOutput("  \n Usage: x   \r\n\n\n\n│ a │    \n   "), "Usage: x\n\n│ a │");
});

function harness(tools?: readonly ToolSpec[]) {
  const sent: any[] = [];
  const h = createMcpHandler({ tools, send: (line) => sent.push(JSON.parse(line)) });
  return { ...h, sent };
}

const echo: ToolSpec = {
  name: "echo",
  description: "echo",
  parameters: { word: { type: "string", required: true, description: "w" } },
  async execute(args) {
    return { text: `said ${args.word}`, extra: 1, skipped: undefined };
  },
};

test("initialize echoes a supported protocol version and falls back to the latest", async () => {
  const h = harness();
  await h.handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } });
  await h.handle({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "2099-01-01" } });
  assert.equal(h.sent[0].result.protocolVersion, "2025-03-26");
  assert.equal(h.sent[1].result.protocolVersion, "2025-06-18");
  assert.equal(h.sent[0].result.serverInfo.name, "dsh-deeptutor");
  assert.ok(h.sent[0].result.capabilities.tools);
});

test("tools/list exposes the four tools with JSON Schema inputs", async () => {
  const h = harness();
  await h.handle({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  const tools = h.sent[0].result.tools;
  assert.deepEqual(
    tools.map((t: any) => t.name),
    ["deeptutor_run", "deeptutor_kb", "deeptutor_note", "deeptutor_cli"],
  );
  const run = tools[0].inputSchema;
  assert.equal(run.type, "object");
  assert.deepEqual(run.required, ["capability", "prompt"]);
  assert.equal(run.properties.capability.enum, undefined, "capability must not be a hard-coded enum");
  assert.equal(run.properties.capability.required, undefined, "dsh-style required flags are stripped");
});

test("tools/call returns text plus structured content, dropping undefined", async () => {
  const h = harness([echo]);
  await h.handle({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "echo", arguments: { word: "hi" } } });
  assert.deepEqual(h.sent[0], {
    jsonrpc: "2.0",
    id: 7,
    result: { content: [{ type: "text", text: "said hi" }], structuredContent: { text: "said hi", extra: 1 } },
  });
});

test("tools/call reports invalid arguments and tool errors as isError results", async () => {
  const boom: ToolSpec = { ...echo, name: "boom", async execute() { throw new Error("kaput"); } };
  const h = harness([echo, boom]);
  await h.handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "echo", arguments: {} } });
  await h.handle({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "boom", arguments: { word: "x" } } });
  await h.handle({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "nope" } });
  assert.equal(h.sent[0].result.isError, true);
  assert.match(h.sent[0].result.content[0].text, /missing required parameter "word"/);
  assert.equal(h.sent[1].result.isError, true);
  assert.equal(h.sent[1].result.content[0].text, "kaput");
  assert.equal(h.sent[2].error.code, -32602);
});

test("notifications/cancelled aborts the call and suppresses its response", async () => {
  let release!: () => void;
  const slow: ToolSpec = {
    ...echo,
    name: "slow",
    execute: (_args, signal) =>
      new Promise((resolve, reject) => {
        release = () => resolve({ text: "late" });
        signal.addEventListener("abort", () => reject(new Error("aborted")));
      }),
  };
  const h = harness([slow]);
  const pending = h.handle({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "slow", arguments: { word: "x" } } });
  await h.handle({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 9 } });
  await pending;
  assert.deepEqual(h.sent, []);
  release();
});

test("ping answers, unknown methods error, notifications get no reply", async () => {
  const h = harness();
  await h.handle({ jsonrpc: "2.0", id: 1, method: "ping" });
  await h.handle({ jsonrpc: "2.0", id: 2, method: "resources/list" });
  await h.handle({ jsonrpc: "2.0", method: "notifications/initialized" });
  assert.deepEqual(h.sent[0].result, {});
  assert.equal(h.sent[1].error.code, -32601);
  assert.equal(h.sent.length, 2);
});

test("validateArgs checks types and enums", () => {
  const kb = TOOLS.find((t) => t.name === "deeptutor_kb")!;
  assert.deepEqual(validateArgs(kb.parameters, { action: "list" }), []);
  assert.match(validateArgs(kb.parameters, { action: "drop" })[0], /one of: list, search, info/);
  const cli = TOOLS.find((t) => t.name === "deeptutor_cli")!;
  assert.match(validateArgs(cli.parameters, { args: "kb list" })[0], /array of strings/);
  assert.deepEqual(toJsonSchema(cli.parameters).required, ["args"]);
});

test("deeptutor_cli refuses blocked commands and asks for confirmation before writes", async () => {
  const cli = TOOLS.find((t) => t.name === "deeptutor_cli")!;
  const signal = new AbortController().signal;
  await assert.rejects(cli.execute({ args: ["kb", "delete", "x"] }, signal), /refused/);
  await assert.rejects(cli.execute({ args: ["kb", "create", "x"] }, signal), /needs confirmation/);
});

test("the stdio server answers initialize over a real process", async () => {
  const entry = fileURLToPath(new URL("../src/mcp-main.ts", import.meta.url));
  const child = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", entry], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  const line = await new Promise<string>((resolve, reject) => {
    let buf = "";
    child.stdout.on("data", (d) => {
      buf += d;
      const nl = buf.indexOf("\n");
      if (nl >= 0) resolve(buf.slice(0, nl));
    });
    child.on("error", reject);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) + "\n");
  });
  child.stdin.end();
  const msg = JSON.parse(line);
  assert.equal(msg.id, 1);
  assert.equal(msg.result.serverInfo.name, "dsh-deeptutor");
});
