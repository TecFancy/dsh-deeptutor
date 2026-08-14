import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";

// config.ts reads DEEPTUTOR_API_BASE at import time — point it at a local
// server before loading http-api.ts (each test file runs in its own process,
// so this cannot leak into other test files).
const server: Server = createServer((req, res) => {
  if (req.url === "/api/v1/ok") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ hello: "world" }));
  } else if (req.url === "/api/v1/error") {
    res.writeHead(503, { "Content-Type": "text/plain" });
    res.end("unavailable");
  } else if (req.url === "/api/v1/empty") {
    res.writeHead(204);
    res.end();
  } else {
    // /api/v1/slow and anything else: never respond — used for timeout/abort tests
  }
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert.ok(address && typeof address === "object", "server must listen on a port");
process.env.DEEPTUTOR_API_BASE = `http://127.0.0.1:${address.port}`;
const { apiJson } = await import("../src/http-api.ts");

after(() => server.close());

test("apiJson parses JSON responses", async () => {
  const body = await apiJson("/api/v1/ok");
  assert.deepEqual(body, { hello: "world" });
});

test("apiJson throws on non-2xx status with the status in the message", async () => {
  await assert.rejects(apiJson("/api/v1/error"), /HTTP 503/);
});

test("apiJson returns null for an empty body", async () => {
  assert.equal(await apiJson("/api/v1/empty"), null);
});

test("apiJson rejects when the caller's signal aborts mid-flight", async () => {
  const controller = new AbortController();
  const pending = apiJson("/api/v1/slow", undefined, { signal: controller.signal });
  setTimeout(() => controller.abort(), 20);
  await assert.rejects(pending, /abort/i);
});

test("apiJson rejects when its own timeout expires", async () => {
  await assert.rejects(apiJson("/api/v1/slow", undefined, { timeoutMs: 100 }), /abort/i);
});

test("apiJson rejects immediately when the signal is already aborted", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(apiJson("/api/v1/ok", undefined, { signal: controller.signal }), /abort/i);
});
