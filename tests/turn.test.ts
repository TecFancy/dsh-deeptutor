import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildRunArgs,
  cliRunTurn,
  collectEvent,
  fmtTurnResult,
  wsRunTurn,
  type RunParams,
  type TurnResult,
} from "../src/turn.ts";

const newState = (): TurnResult => ({ answer: "", errors: [], toolCalls: [] });

test("collectEvent accumulates streamed content chunks", () => {
  const s = newState();
  collectEvent(s, { type: "content", content: "Hello " });
  collectEvent(s, { type: "content", content: "world" });
  assert.equal(s.answer, "Hello world");
});

test("collectEvent replaces the answer on a final result event", () => {
  const s = newState();
  collectEvent(s, { type: "content", content: "partial" });
  collectEvent(s, { type: "result", metadata: { response: "final answer" } });
  assert.equal(s.answer, "final answer");
});

test("collectEvent records errors, tool calls, title and session id", () => {
  const s = newState();
  collectEvent(s, { type: "error", content: "boom" });
  collectEvent(s, { type: "tool_call", content: "rag" });
  collectEvent(s, { type: "tool_call", metadata: { name: "web_search" } });
  collectEvent(s, { type: "session_meta", metadata: { title: "T" }, session_id: "s1" });
  assert.deepEqual(s.errors, ["boom"]);
  assert.deepEqual(s.toolCalls, ["rag", "web_search"]);
  assert.equal(s.title, "T");
  assert.equal(s.sessionId, "s1");
});

test("collectEvent ignores malformed events without throwing", () => {
  const s = newState();
  collectEvent(s, { type: "content", content: 42 });
  collectEvent(s, { type: "unknown_event" });
  assert.equal(s.answer, "");
});

test("fmtTurnResult includes session id, dedupes tool calls, truncates long answers", () => {
  const out = fmtTurnResult(
    "deep_solve",
    { answer: "x".repeat(5000), errors: [], toolCalls: ["rag", "rag"], sessionId: "abc" },
    100,
  );
  assert.match(out, /\[deeptutor deep_solve done\]/);
  assert.match(out, /session_id: abc/);
  assert.match(out, /tools used: rag/);
  assert.ok(!out.includes("rag, rag"));
  assert.match(out, /\[truncated, 5000 chars total\]/);
});

test("fmtTurnResult reports errors and missing answers", () => {
  const out = fmtTurnResult("chat", { answer: "", errors: ["step failed"], toolCalls: [] }, 100);
  assert.match(out, /note \(some steps failed\): step failed/);
  assert.match(out, /\(no answer\)/);
});

// ---------- wsRunTurn (WebSocket path) ----------

/** Minimal injectable WebSocket stand-in: tests drive the lifecycle by hand. */
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  url: string;
  sent: string[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
  }
  open() {
    this.onopen?.();
  }
  message(event: unknown) {
    this.onmessage?.({ data: JSON.stringify(event) });
  }
  error() {
    this.onerror?.();
  }
  closeEvent() {
    this.onclose?.();
  }
}

const setupWs = () => {
  (globalThis as any).WebSocket = FakeWebSocket;
  FakeWebSocket.instances = [];
};

const wsParams: RunParams = { prompt: "explain X", capability: "deep_solve" };

test("wsRunTurn sends a start_turn frame with the params", async () => {
  setupWs();
  const p = wsRunTurn(wsParams, 5000);
  const ws = FakeWebSocket.instances[0];
  ws.open();
  const frame = JSON.parse(ws.sent[0]);
  assert.equal(frame.type, "start_turn");
  assert.equal(frame.content, "explain X");
  assert.equal(frame.capability, "deep_solve");
  assert.deepEqual(frame.tools, []);
  assert.deepEqual(frame.knowledge_bases, []);
  ws.message({ type: "done" });
  await p;
});

test("wsRunTurn resolves with the accumulated state on done", async () => {
  setupWs();
  const p = wsRunTurn(wsParams, 5000);
  const ws = FakeWebSocket.instances[0];
  ws.open();
  ws.message({ type: "content", content: "Hello " });
  ws.message({ type: "content", content: "world" });
  ws.message({ type: "tool_call", content: "rag" });
  ws.message({ type: "session_meta", metadata: { title: "T" }, session_id: "s1" });
  ws.message({ type: "done" });
  const state = await p;
  assert.equal(state.answer, "Hello world");
  assert.deepEqual(state.toolCalls, ["rag"]);
  assert.equal(state.title, "T");
  assert.equal(state.sessionId, "s1");
  assert.ok(ws.closed, "socket should be closed after done");
});

test("wsRunTurn rejects on connection error and unexpected close", async () => {
  setupWs();
  const errored = wsRunTurn(wsParams, 5000);
  FakeWebSocket.instances[0].open();
  FakeWebSocket.instances[0].error();
  await assert.rejects(errored, /connection error/);

  setupWs();
  const closed = wsRunTurn(wsParams, 5000);
  FakeWebSocket.instances[0].open();
  FakeWebSocket.instances[0].closeEvent();
  await assert.rejects(closed, /closed unexpectedly/);
});

test("wsRunTurn rejects on timeout when the server never sends done", async () => {
  setupWs();
  const p = wsRunTurn(wsParams, 50);
  FakeWebSocket.instances[0].open();
  await assert.rejects(p, /WebSocket timeout/);
});

test("wsRunTurn rejects immediately when the signal is already aborted", async () => {
  setupWs();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(wsRunTurn(wsParams, 5000, controller.signal), /Aborted/);
});

test("wsRunTurn rejects on abort mid-flight", async () => {
  setupWs();
  const controller = new AbortController();
  const p = wsRunTurn(wsParams, 5000, controller.signal);
  const ws = FakeWebSocket.instances[0];
  ws.open();
  controller.abort();
  await assert.rejects(p, /Aborted/);
  assert.ok(ws.closed, "socket should be closed after abort");
});

// ---------- cliRunTurn (CLI fallback path) ----------

test("buildRunArgs assembles kbs/tools/session/language flags", () => {
  const args = buildRunArgs({
    prompt: "p",
    capability: "deep_solve",
    kbs: ["kb1"],
    tools: ["rag", "web_search"],
    session_id: "s1",
    language: "zh",
  });
  assert.deepEqual(args, [
    "run",
    "deep_solve",
    "p",
    "--format",
    "json",
    "--kb",
    "kb1",
    "--tool",
    "rag",
    "--tool",
    "web_search",
    "--session",
    "s1",
    "--language",
    "zh",
  ]);
});

test("buildRunArgs pushes scalar config as --config and complex config as --config-json", () => {
  const args = buildRunArgs({
    prompt: "p",
    capability: "deep_question",
    config: { num_questions: 5, nested: { a: 1 }, list: [1, 2] },
  });
  assert.ok(args.includes("--config"));
  assert.ok(args.includes("num_questions=5"));
  const complexIdx = args.indexOf("--config-json");
  assert.ok(complexIdx >= 0);
  assert.deepEqual(JSON.parse(args[complexIdx + 1]), { nested: { a: 1 }, list: [1, 2] });
  assert.ok(!args.some((a) => a.startsWith("nested=") || a.startsWith("list=")));
});

test("cliRunTurn reports cancellation when the CLI run was killed by abort", async () => {
  const controller = new AbortController();
  // The fake CLI run stays in flight until the user cancels, then reports
  // killed=true — exactly what runCli returns after an abort-driven taskkill.
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const fakeRun = async () => {
    await gate;
    return { stdout: "", stderr: "x", code: -1, killed: true };
  };
  const pending = cliRunTurn(wsParams, 1000, controller.signal, fakeRun as any);
  controller.abort();
  release();
  await assert.rejects(pending, /Aborted/);
});

test("cliRunTurn reports timeout when killed without an abort signal", async () => {
  const fakeRun = async () => ({ stdout: "", stderr: "x", code: -1, killed: true });
  await assert.rejects(cliRunTurn(wsParams, 1000, undefined, fakeRun as any), /timed out/);
});

test("cliRunTurn throws the CLI error on non-zero exit", async () => {
  const fakeRun = async () => ({ stdout: "", stderr: "boom", code: 2, killed: false });
  await assert.rejects(
    cliRunTurn(wsParams, 1000, undefined, fakeRun as any),
    /CLI exit=2: boom/,
  );
});

test("cliRunTurn collects JSONL events into the turn state", async () => {
  const fakeRun = async () => ({
    stdout:
      JSON.stringify({ type: "content", content: "A" }) +
      "\n" +
      JSON.stringify({ type: "session_meta", metadata: { title: "T" }, session_id: "s" }),
    stderr: "",
    code: 0,
    killed: false,
  });
  const state = await cliRunTurn(wsParams, 1000, undefined, fakeRun as any);
  assert.equal(state.answer, "A");
  assert.equal(state.title, "T");
  assert.equal(state.sessionId, "s");
});
